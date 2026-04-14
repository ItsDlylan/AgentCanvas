import { useState, useCallback, useRef, useEffect } from 'react'
import type { VoiceMode, VoiceSettings } from '@/voice/types'
import { createVAD, type VADInstance } from '@/voice/vad'

export interface UseVoiceReturn {
  mode: VoiceMode
  transcript: string | null
  error: string | null
  startListening: () => void
  stopListening: () => void
  confirm: () => void
  cancel: () => void
}

export function useVoice(settings: VoiceSettings): UseVoiceReturn {
  const [mode, setMode] = useState<VoiceMode>('idle')
  const [transcript, setTranscript] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const vadRef = useRef<VADInstance | null>(null)
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modelReady = useRef(false)

  // Ensure Whisper model is downloaded before first transcription
  useEffect(() => {
    if (!settings.enabled) return
    window.voice.getModelStatus().then((models) => {
      const target = models.find((m) => m.model === settings.whisperModel)
      if (target?.downloaded) {
        modelReady.current = true
      }
    })
  }, [settings.enabled, settings.whisperModel])

  // Clear error/transcript after display
  useEffect(() => {
    if (mode === 'idle' && (transcript || error)) {
      cleanupTimerRef.current = setTimeout(() => {
        setTranscript(null)
        setError(null)
      }, 4000)
    }
    return () => {
      if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current)
    }
  }, [mode, transcript, error])

  const transcribeAudio = useCallback(async (audio: Float32Array) => {
    setMode('processing')
    try {
      // Auto-download model on first use
      if (!modelReady.current) {
        setTranscript(`Downloading ${settings.whisperModel} model...`)
        const dl = await window.voice.loadModel(settings.whisperModel)
        if (!dl.ok) {
          setError(dl.error ?? 'Model download failed')
          setMode('idle')
          return
        }
        modelReady.current = true
      }

      setTranscript('Transcribing...')
      const result = await window.voice.transcribe(audio, settings.sttProvider)
      const text = result.text.trim()
      if (!text) {
        setTranscript(null)
        setMode('idle')
        return
      }
      setTranscript(text)
      setMode('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed')
      setMode('idle')
    }
  }, [settings.sttProvider, settings.whisperModel])

  const startListening = useCallback(async () => {
    if (mode !== 'idle') return

    setError(null)
    setTranscript(null)
    setMode('listening')

    try {
      // Create VAD if not already active
      if (!vadRef.current) {
        vadRef.current = await createVAD({
          onSpeechStart: () => {
            // Visual feedback is already handled by mode === 'listening'
          },
          onSpeechEnd: (audio) => {
            transcribeAudio(audio)
          },
          onVADMisfire: () => {
            // Speech was too short to be meaningful
          }
        })
      }
      vadRef.current.start()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start voice capture')
      setMode('idle')
    }
  }, [mode, transcribeAudio])

  const stopListening = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.pause()
    }
    // If we were just listening (no speech detected), go back to idle
    if (mode === 'listening') {
      setMode('idle')
    }
  }, [mode])

  const confirm = useCallback(() => {
    if (mode === 'confirming') {
      // Will be wired to action executor in M2
      setMode('idle')
    }
  }, [mode])

  const cancel = useCallback(() => {
    if (mode === 'confirming') {
      setTranscript(null)
      setMode('idle')
    }
  }, [mode])

  // Cleanup VAD on unmount
  useEffect(() => {
    return () => {
      if (vadRef.current) {
        vadRef.current.destroy()
        vadRef.current = null
      }
    }
  }, [])

  return { mode, transcript, error, startListening, stopListening, confirm, cancel }
}

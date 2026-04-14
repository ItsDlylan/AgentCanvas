import { useState, useCallback, useRef, useEffect } from 'react'
import type { VoiceMode, VoiceSettings, VoiceAction } from '@/voice/types'
import { createVAD, type VADInstance } from '@/voice/vad'
import { matchCommand } from '@/voice/command-router'
import { executeAction } from '@/voice/action-executor'

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
  const modeRef = useRef<VoiceMode>(mode)
  modeRef.current = mode

  // Pending destructive action waiting for confirmation
  const pendingAction = useRef<VoiceAction | null>(null)

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

  const processCommand = useCallback((text: string) => {
    const result = matchCommand(text, modeRef.current)

    if (!result) {
      // No command matched — just show the transcript
      setTranscript(text)
      setMode('idle')
      return
    }

    // Handle confirmation responses
    if (result.action.type === 'confirm.yes') {
      const pending = pendingAction.current
      pendingAction.current = null
      if (pending) {
        const execResult = executeAction(pending)
        setTranscript(execResult.message)
      }
      setMode('idle')
      return
    }
    if (result.action.type === 'confirm.no') {
      pendingAction.current = null
      setTranscript('Cancelled')
      setMode('idle')
      return
    }

    // Destructive actions need confirmation
    if (result.action.destructive) {
      pendingAction.current = result.action
      setTranscript(`${result.normalized}?`)
      setMode('confirming')
      return
    }

    // Non-destructive: execute immediately
    const execResult = executeAction(result.action)
    setTranscript(execResult.message)
    if (!execResult.ok) {
      setError(execResult.message)
      setTranscript(null)
    }
    setMode('idle')
  }, [])

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

      // Route through command system
      processCommand(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed')
      setMode('idle')
    }
  }, [settings.sttProvider, settings.whisperModel, processCommand])

  const startListening = useCallback(async () => {
    if (mode !== 'idle' && mode !== 'confirming') return

    setError(null)
    if (mode !== 'confirming') setTranscript(null)
    setMode(mode === 'confirming' ? 'confirming' : 'listening')

    // For confirming mode, start listening for yes/no
    if (mode === 'confirming') {
      setMode('listening')
    }

    try {
      if (!vadRef.current) {
        vadRef.current = await createVAD({
          onSpeechStart: () => {},
          onSpeechEnd: (audio) => {
            transcribeAudio(audio)
          },
          onVADMisfire: () => {}
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
    if (mode === 'listening') {
      setMode(pendingAction.current ? 'confirming' : 'idle')
    }
  }, [mode])

  const confirm = useCallback(() => {
    if (mode === 'confirming') {
      const pending = pendingAction.current
      pendingAction.current = null
      if (pending) {
        const result = executeAction(pending)
        setTranscript(result.message)
      }
      setMode('idle')
    }
  }, [mode])

  const cancel = useCallback(() => {
    if (mode === 'confirming') {
      pendingAction.current = null
      setTranscript('Cancelled')
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

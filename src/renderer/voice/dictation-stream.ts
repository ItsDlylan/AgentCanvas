// ── Dictation Stream Engine ──────────────────────────────
// Captures audio continuously, sends VAD-aware chunks to Whisper,
// deduplicates overlapping results, and streams progressive text.
// Uses the 'base' Whisper model for accuracy over latency.

import { createVAD, type VADInstance } from './vad'

const SAMPLE_RATE = 16000

// ── Types ────────────────────────────────────────────────

export interface DictationStreamConfig {
  chunkMaxMs: number        // max ms before force-sending a chunk (default 7000)
  overlapMs: number         // overlap audio retained between chunks (default 2000)
  silenceTimeoutMs: number  // silence before auto-completing dictation (default 3000)
  whisperModel: 'base' | 'small'
  deviceId?: string | null
}

export interface DictationStreamCallbacks {
  onChunkTranscribed: (newWords: string, fullText: string) => void
  onDictationComplete: (fullText: string) => void
  onError: (error: string) => void
  onSpeechActivity: (speaking: boolean) => void
}

export interface DictationStreamInstance {
  start: () => Promise<void>
  stop: () => void
  destroy: () => void
  getFullText: () => string
  readonly active: boolean
}

const DEFAULT_CONFIG: DictationStreamConfig = {
  chunkMaxMs: 7000,
  overlapMs: 2000,
  silenceTimeoutMs: 3000,
  whisperModel: 'base',
  deviceId: null
}

// ── LCS Deduplication ────────────────────────────────────
// Finds the longest common sequence between the tail of previous
// transcript and head of new chunk to remove duplicated words.

const DEDUP_WINDOW = 10

function deduplicateChunk(prevWords: string[], chunkText: string): { newText: string; updatedTail: string[] } {
  const trimmed = chunkText.trim()
  if (!trimmed) return { newText: '', updatedTail: prevWords }

  const chunkWords = trimmed.split(/\s+/)

  if (prevWords.length === 0) {
    return {
      newText: trimmed,
      updatedTail: chunkWords.slice(-DEDUP_WINDOW)
    }
  }

  // Find longest suffix of prevWords that matches a prefix of chunkWords
  let bestOverlap = 0
  const maxCheck = Math.min(prevWords.length, chunkWords.length, DEDUP_WINDOW)

  for (let len = 1; len <= maxCheck; len++) {
    const suffix = prevWords.slice(-len).map(w => w.toLowerCase()).join(' ')
    const prefix = chunkWords.slice(0, len).map(w => w.toLowerCase()).join(' ')
    if (suffix === prefix) {
      bestOverlap = len
    }
  }

  const newWords = chunkWords.slice(bestOverlap)
  const newText = newWords.join(' ')

  return {
    newText,
    updatedTail: chunkWords.slice(-DEDUP_WINDOW)
  }
}

// ── Factory ──────────────────────────────────────────────

export async function createDictationStream(
  config: Partial<DictationStreamConfig>,
  callbacks: DictationStreamCallbacks
): Promise<DictationStreamInstance> {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // State
  let active = false
  let audioBuffer = new Float32Array(0)
  let fullTranscript = ''
  let prevTailWords: string[] = []
  let silenceTimer: ReturnType<typeof setTimeout> | null = null
  let chunkForceTimer: ReturnType<typeof setInterval> | null = null
  let speaking = false
  let transcribing = false
  let pendingFlush = false  // flush requested while transcription in flight

  // Audio capture resources
  let mediaStream: MediaStream | null = null
  let audioContext: AudioContext | null = null
  let processorNode: ScriptProcessorNode | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let vad: VADInstance | null = null

  // ── Audio buffer management ──

  function appendAudio(samples: Float32Array) {
    const newBuffer = new Float32Array(audioBuffer.length + samples.length)
    newBuffer.set(audioBuffer)
    newBuffer.set(samples, audioBuffer.length)
    audioBuffer = newBuffer
  }

  function sliceChunk(): Float32Array | null {
    const minSamples = Math.floor(SAMPLE_RATE * 0.5) // 0.5s minimum
    if (audioBuffer.length < minSamples) return null

    const chunk = new Float32Array(audioBuffer)

    // Retain overlap for next chunk
    const overlapSamples = Math.floor(SAMPLE_RATE * cfg.overlapMs / 1000)
    if (audioBuffer.length > overlapSamples) {
      audioBuffer = audioBuffer.slice(-overlapSamples)
    } else {
      audioBuffer = new Float32Array(0)
    }

    return chunk
  }

  // ── Transcription ──

  async function transcribeChunk(chunk: Float32Array, isFinal: boolean) {
    transcribing = true
    try {
      const result = await window.voice.transcribe(chunk, undefined, cfg.whisperModel)
      if (!active && !isFinal) {
        transcribing = false
        return
      }

      const text = result.text.trim()
      if (text) {
        const { newText, updatedTail } = deduplicateChunk(prevTailWords, text)
        prevTailWords = updatedTail

        if (newText) {
          fullTranscript = fullTranscript ? fullTranscript + ' ' + newText : newText
          callbacks.onChunkTranscribed(newText, fullTranscript)
        }
      }
    } catch (err) {
      if (active) {
        callbacks.onError(err instanceof Error ? err.message : 'Transcription failed')
      }
    } finally {
      transcribing = false

      // If a flush was requested while we were transcribing, do it now
      if (pendingFlush) {
        pendingFlush = false
        flushAndComplete()
      }
    }
  }

  function sendCurrentChunk() {
    const chunk = sliceChunk()
    if (chunk && !transcribing) {
      transcribeChunk(chunk, false)
    }
  }

  // ── Silence detection ──

  function resetSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer)
      silenceTimer = null
    }
  }

  function startSilenceTimer() {
    resetSilenceTimer()
    silenceTimer = setTimeout(() => {
      if (active) {
        flushAndComplete()
      }
    }, cfg.silenceTimeoutMs)
  }

  // ── Chunk force timer ──

  function startChunkForceTimer() {
    if (chunkForceTimer) return
    chunkForceTimer = setInterval(() => {
      if (active && speaking && !transcribing) {
        sendCurrentChunk()
      }
    }, cfg.chunkMaxMs)
  }

  function stopChunkForceTimer() {
    if (chunkForceTimer) {
      clearInterval(chunkForceTimer)
      chunkForceTimer = null
    }
  }

  // ── Completion ──

  function flushAndComplete() {
    if (!active) return

    // If a transcription is in flight, defer
    if (transcribing) {
      pendingFlush = true
      return
    }

    const chunk = sliceChunk()
    if (chunk) {
      // Transcribe final chunk, then complete
      active = false
      stopChunkForceTimer()
      resetSilenceTimer()
      transcribing = true

      window.voice.transcribe(chunk, undefined, cfg.whisperModel)
        .then((result) => {
          const text = result.text.trim()
          if (text) {
            const { newText } = deduplicateChunk(prevTailWords, text)
            if (newText) {
              fullTranscript = fullTranscript ? fullTranscript + ' ' + newText : newText
            }
          }
          callbacks.onDictationComplete(fullTranscript)
        })
        .catch(() => {
          // Complete with what we have even if final chunk fails
          callbacks.onDictationComplete(fullTranscript)
        })
        .finally(() => {
          transcribing = false
        })
    } else {
      active = false
      stopChunkForceTimer()
      resetSilenceTimer()
      callbacks.onDictationComplete(fullTranscript)
    }
  }

  // ── Cleanup ──

  function teardown() {
    active = false
    stopChunkForceTimer()
    resetSilenceTimer()

    if (vad) {
      vad.destroy()
      vad = null
    }
    if (processorNode) {
      processorNode.disconnect()
      processorNode = null
    }
    if (sourceNode) {
      sourceNode.disconnect()
      sourceNode = null
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop())
      mediaStream = null
    }
    if (audioContext) {
      audioContext.close()
      audioContext = null
    }
  }

  // ── Public API ──

  return {
    start: async () => {
      if (active) return

      try {
        // Open mic
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: SAMPLE_RATE,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...(cfg.deviceId ? { deviceId: { exact: cfg.deviceId } } : {})
          }
        })

        // Set up audio capture via ScriptProcessorNode
        audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
        sourceNode = audioContext.createMediaStreamSource(mediaStream)
        processorNode = audioContext.createScriptProcessor(2048, 1, 1)

        processorNode.onaudioprocess = (e) => {
          if (!active) return
          const input = e.inputBuffer.getChannelData(0)
          appendAudio(input)
        }

        sourceNode.connect(processorNode)
        processorNode.connect(audioContext.destination)

        // Set up VAD for speech boundary detection
        // Clone the stream so VAD doesn't fight with our ScriptProcessor
        const vadStream = mediaStream.clone()
        vad = await createVAD(
          {
            onSpeechStart: () => {
              speaking = true
              callbacks.onSpeechActivity(true)
              resetSilenceTimer()
              startChunkForceTimer()
            },
            onSpeechEnd: () => {
              speaking = false
              callbacks.onSpeechActivity(false)
              stopChunkForceTimer()

              // Natural pause — send accumulated audio as a chunk
              if (active && !transcribing) {
                sendCurrentChunk()
              }

              // Start silence timer for auto-complete
              startSilenceTimer()
            },
            onVADMisfire: () => {}
          },
          {
            // Sensitive pause detection: ~768ms silence triggers speech end
            redemptionFrames: 8,
            minSpeechFrames: 2,
            positiveSpeechThreshold: 0.5,
            negativeSpeechThreshold: 0.35,
            preSpeechPadFrames: 1
          },
          cfg.deviceId
        )

        // Watch for mic disconnect
        mediaStream.getTracks()[0].addEventListener('ended', () => {
          if (active) {
            callbacks.onError('Microphone disconnected')
            teardown()
          }
        })

        active = true
        vad.start()

        // Start initial silence timer — if user doesn't speak within timeout, complete
        startSilenceTimer()
      } catch (err) {
        teardown()
        callbacks.onError(err instanceof Error ? err.message : 'Failed to start dictation stream')
      }
    },

    stop: () => {
      if (!active) return
      flushAndComplete()
    },

    destroy: () => {
      teardown()
      audioBuffer = new Float32Array(0)
      fullTranscript = ''
      prevTailWords = []
    },

    getFullText: () => fullTranscript,

    get active() {
      return active
    }
  }
}

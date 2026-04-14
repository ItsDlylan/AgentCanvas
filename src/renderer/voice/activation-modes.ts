// ── Activation Modes ─────────────────────────────────────
// Manages the three voice activation strategies:
//   - push-to-talk: hotkey driven (current default)
//   - wake-word: continuous audio → main process → wake event → VAD
//   - always-on: VAD always active, restart after each transcription

import type { VADInstance } from './vad'
import { createVAD } from './vad'
import { createAudioStream, type AudioStreamInstance } from './audio-stream'

export type ActivationMode = 'push-to-talk' | 'wake-word' | 'always-on'

export interface ActivationCallbacks {
  onSpeechStart: () => void
  onSpeechEnd: (audio: Float32Array) => void
  onVADMisfire: () => void
  onWakeWordDetected?: () => void
}

export interface ActivationController {
  start: () => Promise<void>
  stop: () => void
  destroy: () => void
  /** Call when wake word is detected (from IPC) */
  handleWakeEvent: () => void
  /** Call when transcription is complete — restarts listening in always-on mode */
  handleTranscriptionComplete: () => void
  mode: ActivationMode
}

export function createActivationController(
  mode: ActivationMode,
  callbacks: ActivationCallbacks,
  deviceId?: string | null
): ActivationController {
  let vad: VADInstance | null = null
  let audioStream: AudioStreamInstance | null = null
  let wakeTimeout: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  async function ensureVAD(): Promise<VADInstance> {
    if (!vad) {
      vad = await createVAD({
        onSpeechStart: callbacks.onSpeechStart,
        onSpeechEnd: callbacks.onSpeechEnd,
        onVADMisfire: callbacks.onVADMisfire
      }, {}, deviceId)
    }
    return vad
  }

  async function startPushToTalk(): Promise<void> {
    const v = await ensureVAD()
    v.start()
  }

  async function startWakeWord(): Promise<void> {
    // Start continuous audio stream for wake word detection
    console.log('[activation] Starting wake word mode — continuous audio stream')
    if (!audioStream) {
      audioStream = await createAudioStream(deviceId)
    }
    audioStream.start()
    console.log('[activation] Audio stream active, listening for wake word')
    // VAD stays paused until wake word is detected
  }

  async function startAlwaysOn(): Promise<void> {
    const v = await ensureVAD()
    v.start()
  }

  return {
    mode,

    start: async () => {
      if (destroyed) return
      switch (mode) {
        case 'push-to-talk':
          await startPushToTalk()
          break
        case 'wake-word':
          await startWakeWord()
          break
        case 'always-on':
          await startAlwaysOn()
          break
      }
    },

    stop: () => {
      if (vad) vad.pause()
      if (audioStream) audioStream.stop()
      if (wakeTimeout) {
        clearTimeout(wakeTimeout)
        wakeTimeout = null
      }
    },

    destroy: () => {
      destroyed = true
      if (vad) {
        vad.destroy()
        vad = null
      }
      if (audioStream) {
        audioStream.destroy()
        audioStream = null
      }
      if (wakeTimeout) {
        clearTimeout(wakeTimeout)
        wakeTimeout = null
      }
    },

    handleWakeEvent: () => {
      if (mode !== 'wake-word' || destroyed) return

      callbacks.onWakeWordDetected?.()

      // Stop audio stream to wake word engine, start VAD for command capture
      if (audioStream) audioStream.stop()

      ensureVAD().then((v) => {
        v.start()

        // Auto-timeout after 10s if no speech detected
        wakeTimeout = setTimeout(() => {
          v.pause()
          // Resume wake word monitoring
          if (audioStream && !destroyed) audioStream.start()
        }, 10000)
      })
    },

    handleTranscriptionComplete: () => {
      if (destroyed) return

      if (wakeTimeout) {
        clearTimeout(wakeTimeout)
        wakeTimeout = null
      }

      switch (mode) {
        case 'wake-word':
          // Return to wake word monitoring
          if (vad) vad.pause()
          if (audioStream) audioStream.start()
          break
        case 'always-on':
          // Restart VAD immediately
          if (vad) vad.start()
          break
        case 'push-to-talk':
          // Stop until next hotkey press
          if (vad) vad.pause()
          break
      }
    }
  }
}

// ── Voice Activity Detection wrapper ──────────────────────
// Wraps @ricky0123/vad-web's MicVAD for speech boundary detection.
// Fires callbacks when speech starts/ends with the captured audio segment.

import { MicVAD, type RealTimeVADOptions } from '@ricky0123/vad-web'

export interface VADCallbacks {
  onSpeechStart?: () => void
  onSpeechEnd?: (audio: Float32Array) => void
  onVADMisfire?: () => void
}

export interface VADInstance {
  start: () => void
  pause: () => void
  destroy: () => void
  listening: boolean
}

export interface VADOptions {
  positiveSpeechThreshold?: number
  negativeSpeechThreshold?: number
  preSpeechPadFrames?: number
  redemptionFrames?: number
  minSpeechFrames?: number
}

const DEFAULT_OPTIONS: VADOptions = {
  positiveSpeechThreshold: 0.8,
  negativeSpeechThreshold: 0.3,
  preSpeechPadFrames: 3,
  redemptionFrames: 8,
  minSpeechFrames: 3
}

export async function createVAD(
  callbacks: VADCallbacks,
  options: VADOptions = {}
): Promise<VADInstance> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // VAD model + worklet are served from public/vad/ as static assets.
  // ONNX Runtime WASM files resolve through Vite's node_modules serving — do NOT override onnxWASMBasePath.
  const basePath = import.meta.env.DEV ? '/vad/' : './vad/'

  const vadOptions: Partial<RealTimeVADOptions> = {
    baseAssetPath: basePath,
    model: 'legacy',
    positiveSpeechThreshold: opts.positiveSpeechThreshold,
    negativeSpeechThreshold: opts.negativeSpeechThreshold,
    preSpeechPadFrames: opts.preSpeechPadFrames,
    redemptionFrames: opts.redemptionFrames,
    minSpeechFrames: opts.minSpeechFrames,
    onSpeechStart: () => {
      callbacks.onSpeechStart?.()
    },
    onSpeechEnd: (audio: Float32Array) => {
      callbacks.onSpeechEnd?.(audio)
    },
    onVADMisfire: () => {
      callbacks.onVADMisfire?.()
    }
  }

  const micVAD = await MicVAD.new(vadOptions)
  let isListening = false

  return {
    start: () => {
      micVAD.start()
      isListening = true
    },
    pause: () => {
      micVAD.pause()
      isListening = false
    },
    destroy: () => {
      micVAD.destroy()
      isListening = false
    },
    get listening() {
      return isListening
    }
  }
}

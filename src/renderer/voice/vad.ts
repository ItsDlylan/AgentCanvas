// ── Voice Activity Detection wrapper ──────────────────────
// Wraps @ricky0123/vad-web's MicVAD for speech boundary detection.
// Fires callbacks when speech starts/ends with the captured audio segment.

import { MicVAD, ort, type RealTimeVADOptions } from '@ricky0123/vad-web'

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

  // Resolve asset paths — in dev, Vite serves from public/; in prod, from app resources
  const basePath = import.meta.env.DEV ? '/vad/' : './vad/'

  // Disable multi-threaded WASM — avoids needing to serve ort-wasm-simd-threaded.mjs
  // as a module (Vite's public dir can't serve importable JS modules).
  // Single-threaded is fine for the small Silero VAD model.
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = basePath

  const vadOptions: Partial<RealTimeVADOptions> = {
    baseAssetPath: basePath,
    onnxWASMBasePath: basePath,
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

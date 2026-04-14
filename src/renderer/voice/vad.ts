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
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  preSpeechPadFrames: 1,
  redemptionFrames: 8,
  minSpeechFrames: 3
}

export async function createVAD(
  callbacks: VADCallbacks,
  options: VADOptions = {}
): Promise<VADInstance> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // VAD model + worklet served from public/vad/.
  // ONNX Runtime WASM files (.mjs + .wasm) served by the serveOnnxWasm Vite plugin
  // from node_modules — intercepted at the root path.
  const basePath = import.meta.env.DEV ? '/vad/' : './vad/'

  const vadOptions: Partial<RealTimeVADOptions> = {
    baseAssetPath: basePath,
    onnxWASMBasePath: '/',
    model: 'legacy',
    submitUserSpeechOnPause: true,
    positiveSpeechThreshold: opts.positiveSpeechThreshold,
    negativeSpeechThreshold: opts.negativeSpeechThreshold,
    preSpeechPadFrames: opts.preSpeechPadFrames,
    redemptionFrames: opts.redemptionFrames,
    minSpeechFrames: opts.minSpeechFrames,
    onFrameProcessed: (probs) => {
      // Debug: log speech probability every ~500ms (every 16th frame at 30fps)
      if (Math.random() < 0.06) {
        console.log(`[VAD] speech prob: ${probs.isSpeech.toFixed(3)}`)
      }
    },
    onSpeechStart: () => {
      console.log('[VAD] speech start')
      callbacks.onSpeechStart?.()
    },
    onSpeechEnd: (audio: Float32Array) => {
      console.log(`[VAD] speech end — ${audio.length} samples (${(audio.length / 16000).toFixed(1)}s)`)
      callbacks.onSpeechEnd?.(audio)
    },
    onVADMisfire: () => {
      console.log('[VAD] misfire (speech too short)')
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

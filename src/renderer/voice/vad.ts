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
  redemptionFrames: 160,
  minSpeechFrames: 3
}

export async function createVAD(
  callbacks: VADCallbacks,
  options: VADOptions = {},
  deviceId?: string | null
): Promise<VADInstance> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // VAD model + worklet served from public/vad/.
  // ONNX Runtime WASM files (.mjs + .wasm) served by the serveOnnxWasm Vite plugin
  // from node_modules — intercepted at the root path.
  const basePath = import.meta.env.DEV ? '/vad/' : './vad/'

  // Build audio constraints with optional device selection
  const audioConstraints: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: true,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {})
  }

  const getStream = async () => {
    return navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
  }

  const vadOptions: Partial<RealTimeVADOptions> = {
    baseAssetPath: basePath,
    onnxWASMBasePath: '/',
    model: 'legacy',
    submitUserSpeechOnPause: true,
    getStream,
    resumeStream: getStream,
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

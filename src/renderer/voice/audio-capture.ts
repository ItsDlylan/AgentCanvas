// ── Microphone capture for voice features ─────────────────
// Captures 16kHz mono PCM Float32 audio via getUserMedia + AudioContext resampling.
// This is the raw audio source consumed by VAD and STT engines.

export interface MicCapture {
  stream: MediaStream
  audioContext: AudioContext
  stop: () => void
}

export type MicPermissionError = 'denied' | 'not-found' | 'unknown'

export interface MicCaptureResult {
  ok: true
  capture: MicCapture
} | {
  ok: false
  error: MicPermissionError
  message: string
}

export async function startMicCapture(): Promise<MicCaptureResult> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })

    // Create audio context at 16kHz for Whisper/VAD compatibility
    const audioContext = new AudioContext({ sampleRate: 16000 })

    const stop = () => {
      for (const track of stream.getTracks()) {
        track.stop()
      }
      audioContext.close().catch(() => {})
    }

    return { ok: true, capture: { stream, audioContext, stop } }
  } catch (err) {
    const error = err as DOMException
    if (error.name === 'NotAllowedError') {
      return {
        ok: false,
        error: 'denied',
        message: 'Microphone permission denied. Enable it in System Settings > Privacy & Security > Microphone.'
      }
    }
    if (error.name === 'NotFoundError') {
      return {
        ok: false,
        error: 'not-found',
        message: 'No microphone found. Connect a microphone and try again.'
      }
    }
    return {
      ok: false,
      error: 'unknown',
      message: `Microphone error: ${error.message || 'unknown'}`
    }
  }
}

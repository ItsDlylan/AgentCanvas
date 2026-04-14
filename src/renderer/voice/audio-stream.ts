// ── Continuous audio stream ──────────────────────────────
// Captures 80ms frames (1280 samples at 16kHz) from the mic
// and sends them to the main process via IPC for wake word detection.
// Runs independently of VAD — always active in wake-word mode.

const SAMPLE_RATE = 16000
const FRAME_SIZE = 1280  // 80ms at 16kHz

export interface AudioStreamInstance {
  start: () => void
  stop: () => void
  destroy: () => void
  active: boolean
}

export async function createAudioStream(deviceId?: string | null): Promise<AudioStreamInstance> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: SAMPLE_RATE,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {})
    }
  })

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  const source = ctx.createMediaStreamSource(stream)

  // Use ScriptProcessorNode for simplicity (AudioWorklet would need a separate file)
  // bufferSize of 2048 gives us ~128ms chunks, which we'll re-frame into 80ms
  const processor = ctx.createScriptProcessor(2048, 1, 1)

  let buffer = new Float32Array(0)
  let active = false

  processor.onaudioprocess = (e) => {
    if (!active) return

    const input = e.inputBuffer.getChannelData(0)

    // Append to accumulation buffer
    const newBuffer = new Float32Array(buffer.length + input.length)
    newBuffer.set(buffer)
    newBuffer.set(input, buffer.length)
    buffer = newBuffer

    // Extract 1280-sample frames
    while (buffer.length >= FRAME_SIZE) {
      const frame = buffer.slice(0, FRAME_SIZE)
      buffer = buffer.slice(FRAME_SIZE)

      // Send to main process via IPC (pass Float32Array, preload converts to Buffer)
      window.voice.sendAudioFrame(frame)
    }
  }

  source.connect(processor)
  processor.connect(ctx.destination) // Required for ScriptProcessor to fire

  return {
    start: () => {
      active = true
      if (ctx.state === 'suspended') ctx.resume()
    },
    stop: () => {
      active = false
      buffer = new Float32Array(0)
    },
    destroy: () => {
      active = false
      processor.disconnect()
      source.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      ctx.close()
    },
    get active() {
      return active
    }
  }
}

// ── Whisper STT via whisper-node ───────────────────────────
// Transcribes audio files using whisper.cpp through the whisper-node wrapper.
// Manages model downloads and provides transcription API.

import { app } from 'electron'
import { join } from 'path'
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { execSync } from 'child_process'
import { randomUUID } from 'crypto'

type WhisperModel = 'tiny' | 'base' | 'small'

interface TranscriptSegment {
  start: string
  end: string
  speech: string
}

const MODEL_URLS: Record<WhisperModel, string> = {
  tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'
}

const MODEL_SIZES_MB: Record<WhisperModel, number> = {
  tiny: 75,
  base: 142,
  small: 466
}

function getModelsDir(): string {
  const dir = join(app.getPath('userData'), 'models')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getModelPath(model: WhisperModel): string {
  return join(getModelsDir(), `ggml-${model}.en.bin`)
}

export function isModelDownloaded(model: WhisperModel): boolean {
  return existsSync(getModelPath(model))
}

export function getModelStatus(): Array<{ model: string; downloaded: boolean; sizeMB: number; path: string | null }> {
  return (['tiny', 'base', 'small'] as WhisperModel[]).map((model) => ({
    model,
    downloaded: isModelDownloaded(model),
    sizeMB: MODEL_SIZES_MB[model],
    path: isModelDownloaded(model) ? getModelPath(model) : null
  }))
}

export async function downloadModel(
  model: WhisperModel,
  onProgress?: (progress: number) => void
): Promise<{ ok: boolean; error?: string }> {
  const modelPath = getModelPath(model)
  if (existsSync(modelPath)) {
    onProgress?.(100)
    return { ok: true }
  }

  const url = MODEL_URLS[model]
  try {
    // Use curl for progress-friendly download
    const tmpPath = `${modelPath}.tmp`
    execSync(`curl -L -o "${tmpPath}" "${url}"`, {
      timeout: 300000, // 5 minute timeout
      stdio: 'pipe'
    })

    // Move into place atomically
    const { renameSync } = await import('fs')
    renameSync(tmpPath, modelPath)
    onProgress?.(100)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Failed to download model: ${(err as Error).message}` }
  }
}

// Convert Float32Array (PCM 16kHz mono) to WAV file
function float32ToWav(samples: Float32Array): Buffer {
  const numChannels = 1
  const sampleRate = 16000
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = samples.length * (bitsPerSample / 8)
  const headerSize = 44

  const buffer = Buffer.alloc(headerSize + dataSize)

  // RIFF header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)

  // fmt chunk
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // chunk size
  buffer.writeUInt16LE(1, 20) // PCM format
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)

  // data chunk
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  // Convert float32 [-1, 1] to int16
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    const val = s < 0 ? s * 0x8000 : s * 0x7fff
    buffer.writeInt16LE(Math.round(val), headerSize + i * 2)
  }

  return buffer
}

export async function transcribe(
  audioSamples: number[],
  model: WhisperModel = 'tiny'
): Promise<{ text: string; durationMs: number }> {
  const startTime = Date.now()

  const modelPath = getModelPath(model)
  if (!existsSync(modelPath)) {
    throw new Error(`Model '${model}' not downloaded. Call voice:load-model first.`)
  }

  // Write audio to temp WAV file
  const tmpDir = app.getPath('temp')
  const tmpFile = join(tmpDir, `whisper-${randomUUID()}.wav`)
  const float32 = new Float32Array(audioSamples)
  const wavBuffer = float32ToWav(float32)
  writeFileSync(tmpFile, wavBuffer)

  console.log(`[whisper] Transcribing ${float32.length} samples, WAV size: ${wavBuffer.length} bytes, model: ${modelPath}`)

  // Verify audio isn't silent
  let maxSample = 0
  for (let i = 0; i < float32.length; i++) {
    const abs = Math.abs(float32[i])
    if (abs > maxSample) maxSample = abs
  }
  console.log(`[whisper] Audio peak amplitude: ${maxSample.toFixed(4)}`)

  try {
    // Use whisper-node
    const { whisper } = await import('whisper-node')
    console.log(`[whisper] Running whisper.cpp on ${tmpFile}`)
    const result: TranscriptSegment[] | undefined = await whisper(tmpFile, {
      modelPath,
      whisperOptions: {
        language: 'en',
        word_timestamps: false
      }
    })

    console.log(`[whisper] Raw result:`, JSON.stringify(result))

    const text = result
      ? result.map((s) => s.speech).join(' ').trim()
      : ''

    return { text, durationMs: Date.now() - startTime }
  } finally {
    // Clean up temp file
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

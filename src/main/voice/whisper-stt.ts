// ── Whisper STT via whisper-node ───────────────────────────
// Transcribes audio files using whisper.cpp through the whisper-node wrapper.
// Manages model downloads and provides transcription API.

import { app } from 'electron'
import { join } from 'path'
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { execFileSync } from 'child_process'
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
  // Use ~/.agentcanvas/models/ instead of Application Support — whisper.cpp's
  // shell command doesn't quote paths, so spaces in the path break it.
  const dir = join(app.getPath('home'), '.agentcanvas', 'models')
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

  console.log(`[whisper] Received ${audioSamples.length} samples, first 5: [${audioSamples.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`)

  const modelPath = getModelPath(model)
  if (!existsSync(modelPath)) {
    throw new Error(`Model '${model}' not downloaded. Call voice:load-model first.`)
  }

  const float32 = new Float32Array(audioSamples)

  // Find peak amplitude
  let peak = 0
  for (let i = 0; i < float32.length; i++) {
    const abs = Math.abs(float32[i])
    if (abs > peak) peak = abs
  }

  // Normalize quiet audio so Whisper can hear it — scale peak to ~0.9
  if (peak > 0.001 && peak < 0.5) {
    const gain = 0.9 / peak
    console.log(`[whisper] Normalizing audio: peak ${peak.toFixed(4)} → gain ${gain.toFixed(1)}x`)
    for (let i = 0; i < float32.length; i++) {
      float32[i] = Math.max(-1, Math.min(1, float32[i] * gain))
    }
  }

  // Write audio to a stable temp path (not cleaned between runs)
  const tmpFile = join(app.getPath('home'), '.agentcanvas', 'whisper-debug.wav')
  const wavBuffer = float32ToWav(float32)
  writeFileSync(tmpFile, wavBuffer)

  // Verify file was written correctly
  const { statSync } = require('fs') as typeof import('fs')
  const stat = statSync(tmpFile)
  console.log(`[whisper] WAV: ${wavBuffer.length} bytes written, file size on disk: ${stat.size}, peak: ${peak.toFixed(4)}, file: ${tmpFile}`)

  try {
    // Call whisper.cpp directly — whisper-node's wrapper silently drops output
    const appRoot = app.getAppPath()
    const whisperDir = join(appRoot, 'node_modules', 'whisper-node', 'lib', 'whisper.cpp')
    const whisperBin = join(whisperDir, 'main')
    const args = ['-l', 'en', '-m', modelPath, '-f', tmpFile, '--no-timestamps']
    console.log(`[whisper] Running: ${whisperBin} ${args.join(' ')}`)

    const stdout = execFileSync(whisperBin, args, {
      timeout: 30000,
      encoding: 'utf-8',
      cwd: whisperDir
    })

    console.log(`[whisper] Raw stdout: ${JSON.stringify(stdout.slice(0, 500))}`)

    // Parse output — strip whisper.cpp metadata, artifacts, and blank audio markers
    const text = stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line =>
        line &&
        !line.startsWith('whisper_') &&
        !line.startsWith('ggml_') &&
        !line.startsWith('main:') &&
        !line.startsWith('system_info')
      )
      .join(' ')
      .replace(/\[BLANK_AUDIO\]/g, '')
      .replace(/>>/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    console.log(`[whisper] Parsed text: "${text}"`)
    return { text, durationMs: Date.now() - startTime }
  } catch (err) {
    console.error('[whisper] Error:', err)
    return { text: '', durationMs: Date.now() - startTime }
  }
  // Note: keeping WAV file at ~/.agentcanvas/whisper-debug.wav for debugging
}

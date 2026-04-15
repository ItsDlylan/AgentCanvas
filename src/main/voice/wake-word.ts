// ── Wake Word Detection via openWakeWord ─────────────────
// Three-stage ONNX pipeline:
//   1. melspectrogram.onnx  — raw audio (1280 samples) → mel frames
//   2. embedding_model.onnx — 76 mel frames → 96-dim embedding
//   3. classifier.onnx      — 16 embeddings → wake probability
//
// All models downloaded to ~/.agentcanvas/models/wake-word/

import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, renameSync } from 'fs'
import { execFileSync } from 'child_process'
import * as ort from 'onnxruntime-node'

// ── Model URLs ───────────────────────────────────────────

const BASE_URL = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1'

const INFRASTRUCTURE_MODELS = {
  melspectrogram: `${BASE_URL}/melspectrogram.onnx`,
  embedding: `${BASE_URL}/embedding_model.onnx`
} as const

const WAKE_WORD_MODELS: Record<string, string> = {
  hey_jarvis: `${BASE_URL}/hey_jarvis_v0.1.onnx`,
  alexa: `${BASE_URL}/alexa_v0.1.onnx`,
  hey_mycroft: `${BASE_URL}/hey_mycroft_v0.1.onnx`,
  hey_rhasspy: `${BASE_URL}/hey_rhasspy_v0.1.onnx`
}

// ── Paths ────────────────────────────────────────────────

function getWakeWordDir(): string {
  const dir = join(app.getPath('home'), '.agentcanvas', 'models', 'wake-word')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function modelPath(name: string): string {
  return join(getWakeWordDir(), `${name}.onnx`)
}

// ── Download ─────────────────────────────────────────────

function downloadFile(url: string, dest: string): void {
  const tmpPath = `${dest}.tmp`
  execFileSync('curl', ['-L', '-o', tmpPath, url], {
    timeout: 120000,
    stdio: 'pipe'
  })
  renameSync(tmpPath, dest)
}

export function isWakeWordReady(wakeWord: string): boolean {
  const word = normalizeWakeWord(wakeWord)
  return (
    existsSync(modelPath('melspectrogram')) &&
    existsSync(modelPath('embedding_model')) &&
    existsSync(modelPath(word))
  )
}

export function getWakeWordModelStatus(): Array<{ model: string; downloaded: boolean }> {
  return [
    { model: 'melspectrogram', downloaded: existsSync(modelPath('melspectrogram')) },
    { model: 'embedding_model', downloaded: existsSync(modelPath('embedding_model')) },
    ...Object.keys(WAKE_WORD_MODELS).map((w) => ({
      model: w,
      downloaded: existsSync(modelPath(w))
    }))
  ]
}

export async function downloadWakeWordModels(
  wakeWord: string
): Promise<{ ok: boolean; error?: string }> {
  const word = normalizeWakeWord(wakeWord)
  if (!WAKE_WORD_MODELS[word]) {
    return { ok: false, error: `Unknown wake word: ${word}. Available: ${Object.keys(WAKE_WORD_MODELS).join(', ')}` }
  }

  try {
    // Download infrastructure models if needed
    if (!existsSync(modelPath('melspectrogram'))) {
      console.log('[wake-word] Downloading melspectrogram.onnx...')
      downloadFile(INFRASTRUCTURE_MODELS.melspectrogram, modelPath('melspectrogram'))
    }
    if (!existsSync(modelPath('embedding_model'))) {
      console.log('[wake-word] Downloading embedding_model.onnx...')
      downloadFile(INFRASTRUCTURE_MODELS.embedding, modelPath('embedding_model'))
    }

    // Download wake word classifier
    if (!existsSync(modelPath(word))) {
      console.log(`[wake-word] Downloading ${word}.onnx...`)
      downloadFile(WAKE_WORD_MODELS[word], modelPath(word))
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Download failed: ${(err as Error).message}` }
  }
}

// ── Detection Engine ─────────────────────────────────────

let melSession: ort.InferenceSession | null = null
let embeddingSession: ort.InferenceSession | null = null
let classifierSession: ort.InferenceSession | null = null

// Accumulation buffers
let melFrameBuffer: number[][] = []  // accumulated mel frames
let embeddingBuffer: number[][] = [] // accumulated 96-dim embeddings

const MEL_WINDOW_SIZE = 76    // frames needed for one embedding
const MEL_STEP_SIZE = 8       // frames to advance between embeddings
const EMBEDDING_WINDOW = 16   // embeddings needed for one classification
let melFramesSinceLastEmbed = 0

// Classifier tensor names vary per model — discovered at load time
let classifierInputName = ''
let classifierOutputName = ''

export async function loadWakeWordEngine(wakeWord: string): Promise<{ ok: boolean; error?: string }> {
  const word = normalizeWakeWord(wakeWord)

  if (!isWakeWordReady(word)) {
    return { ok: false, error: 'Models not downloaded' }
  }

  try {
    melSession = await ort.InferenceSession.create(modelPath('melspectrogram'))
    embeddingSession = await ort.InferenceSession.create(modelPath('embedding_model'))
    classifierSession = await ort.InferenceSession.create(modelPath(word))

    // Discover classifier tensor names (they vary per wake word model)
    classifierInputName = classifierSession.inputNames[0]
    classifierOutputName = classifierSession.outputNames[0]

    // Reset buffers
    melFrameBuffer = []
    embeddingBuffer = []
    melFramesSinceLastEmbed = 0

    console.log(`[wake-word] Engine loaded for "${word}"`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Failed to load models: ${(err as Error).message}` }
  }
}

export function unloadWakeWordEngine(): void {
  melSession = null
  embeddingSession = null
  classifierSession = null
  melFrameBuffer = []
  embeddingBuffer = []
  melFramesSinceLastEmbed = 0
}

/**
 * Process an 80ms audio frame (1280 samples at 16kHz).
 * Returns wake word probability (0-1) or null if not enough data yet.
 */
let frameCount = 0
let lastLogTime = 0

export async function processAudioFrame(samples: Float32Array): Promise<number | null> {
  if (!melSession || !embeddingSession || !classifierSession) return null
  frameCount++

  // Log pipeline state periodically (every 2s ≈ 25 frames)
  const now = Date.now()
  if (now - lastLogTime > 2000) {
    lastLogTime = now
    console.log(`[wake-word] frames=${frameCount} melBuf=${melFrameBuffer.length} embBuf=${embeddingBuffer.length} samples[0..3]=${samples[0].toFixed(4)},${samples[1].toFixed(4)},${samples[2].toFixed(4)},${samples[3].toFixed(4)}`)
  }

  // Stage 1: Audio → Mel spectrogram
  // melspectrogram.onnx: input="input" [1, 1280] → output="output" [1, 1, 5, 32]
  const audioTensor = new ort.Tensor('float32', samples, [1, samples.length])
  const melResult = await melSession.run({ input: audioTensor })
  const melData = melResult.output.data as Float32Array

  // Post-process: (value / 10.0) + 2.0
  // Output shape is [1, 1, 5, 32] = 160 values = 5 frames x 32 mel bins
  const numMelBins = 32
  const numFrames = 5
  for (let f = 0; f < numFrames; f++) {
    const frame: number[] = []
    for (let j = 0; j < numMelBins; j++) {
      frame.push(melData[f * numMelBins + j] / 10.0 + 2.0)
    }
    melFrameBuffer.push(frame)
    melFramesSinceLastEmbed++
  }

  // Stage 2: Mel frames → Embedding (when we have enough frames and step is met)
  // embedding_model.onnx: input="input_1" [1, 76, 32, 1] → output="conv2d_19" [1, 1, 1, 96]
  if (melFrameBuffer.length >= MEL_WINDOW_SIZE && melFramesSinceLastEmbed >= MEL_STEP_SIZE) {
    melFramesSinceLastEmbed = 0

    const window = melFrameBuffer.slice(-MEL_WINDOW_SIZE)
    const flatWindow = new Float32Array(76 * 32)
    for (let i = 0; i < 76; i++) {
      for (let j = 0; j < 32; j++) {
        flatWindow[i * 32 + j] = window[i][j]
      }
    }

    const embTensor = new ort.Tensor('float32', flatWindow, [1, 76, 32, 1])
    const embResult = await embeddingSession.run({ input_1: embTensor })
    const embedding = Array.from(embResult.conv2d_19.data as Float32Array)

    embeddingBuffer.push(embedding)

    // Trim mel buffer to keep memory bounded
    if (melFrameBuffer.length > MEL_WINDOW_SIZE * 2) {
      melFrameBuffer = melFrameBuffer.slice(-MEL_WINDOW_SIZE)
    }

    // Stage 3: Classify immediately after new embedding (only when fresh)
    // hey_jarvis.onnx: input="x.1" [1, 16, 96] → output="53" [1, 1]
    if (embeddingBuffer.length >= EMBEDDING_WINDOW) {
      const embWindow = embeddingBuffer.slice(-EMBEDDING_WINDOW)
      const flatEmb = new Float32Array(16 * 96)
      for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 96; j++) {
          flatEmb[i * 96 + j] = embWindow[i][j]
        }
      }

      const clsTensor = new ort.Tensor('float32', flatEmb, [1, 16, 96])
      const clsResult = await classifierSession.run({ [classifierInputName]: clsTensor })
      const probability = (clsResult[classifierOutputName].data as Float32Array)[0]

      // Log probability when it's non-trivial
      if (probability > 0.01) {
        console.log(`[wake-word] probability=${probability.toFixed(4)}`)
      }

      // Trim embedding buffer
      if (embeddingBuffer.length > EMBEDDING_WINDOW * 2) {
        embeddingBuffer = embeddingBuffer.slice(-EMBEDDING_WINDOW)
      }

      return probability
    }
  }

  return null
}

// ── Helpers ──────────────────────────────────────────────

function normalizeWakeWord(word: string): string {
  return word.toLowerCase().replace(/\s+/g, '_')
}

export const AVAILABLE_WAKE_WORDS = Object.keys(WAKE_WORD_MODELS)

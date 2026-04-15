// ── Vosk STT (browser WASM) ──────────────────────────────
// Grammar-constrained streaming recognition for known voice commands.
// Runs entirely in the renderer via vosk-browser (WASM).
// Fast path: ~200ms for grammar-matched commands.
// Falls back to null when speech doesn't match grammar → caller uses Whisper.

import { createModel, type Model, type KaldiRecognizer } from 'vosk-browser'
import type { ServerMessageResult, ServerMessagePartialResult } from 'vosk-browser/dist/interfaces'

// ── Grammar ──────────────────────────────────────────────
// All known command phrases that Vosk should recognize instantly.
// Kept in sync with patterns.ts command vocabulary.

const GRAMMAR_PHRASES = [
  // Mode switching
  'start dictation', 'stop dictation',
  // Undo
  'undo',
  // Overlays
  'show numbers', 'show grid',
  'focus one', 'focus two', 'focus three', 'focus four', 'focus five',
  'focus six', 'focus seven', 'focus eight', 'focus nine',
  // Navigation
  'zoom in', 'zoom out', 'zoom to fit', 'show everything', 'fit view',
  // Tile spawning
  'spawn terminal', 'new terminal', 'open terminal',
  'open browser', 'spawn browser', 'new browser',
  'create note', 'new note', 'open note',
  'create draw', 'new draw', 'open draw',
  // Tile destruction
  'close this', 'kill this', 'close focused',
  // Agent control
  'approve', 'yes', 'accept',
  'reject', 'no', 'deny',
  'stop', 'interrupt', 'cancel',
  // Queries
  'status', 'show status', 'whats status',
  'any errors', 'are there errors',
  // Notifications
  'unread', 'last unread', 'go to unread',
  'mark read', 'mark all read',
  // Confirmation
  'go ahead', 'do it', 'confirm', 'nevermind',
  // Wake word phrase (for grammar awareness)
  'hey jarvis',
  // Catch-all for out-of-grammar speech — Vosk maps unknown words here
  // instead of forcing them into the closest grammar word
  '[unk]'
]

const GRAMMAR_JSON = JSON.stringify(GRAMMAR_PHRASES)

// ── Model URL ────────────────────────────────────────────

const MODEL_URL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz'

// ── State ────────────────────────────────────────────────

let model: Model | null = null
let recognizer: KaldiRecognizer | null = null
let loading = false

export type VoskStatus = 'unloaded' | 'loading' | 'ready' | 'error'

let status: VoskStatus = 'unloaded'
let loadError: string | null = null

export function getVoskStatus(): { status: VoskStatus; error: string | null } {
  return { status, error: loadError }
}

// ── Lifecycle ────────────────────────────────────────────

export async function loadVoskModel(): Promise<{ ok: boolean; error?: string }> {
  if (model) return { ok: true }
  if (loading) return { ok: false, error: 'Already loading' }

  loading = true
  status = 'loading'
  loadError = null

  try {
    console.log('[vosk] Loading model from', MODEL_URL)
    model = await createModel(MODEL_URL, 0) // logLevel 0 = errors only
    console.log('[vosk] Model loaded, creating recognizer')

    recognizer = new model.KaldiRecognizer(16000, GRAMMAR_JSON)
    recognizer.setWords(true)

    status = 'ready'
    loading = false
    console.log('[vosk] Ready with grammar-constrained recognizer')
    return { ok: true }
  } catch (err) {
    status = 'error'
    loadError = (err as Error).message
    loading = false
    console.error('[vosk] Load failed:', loadError)
    return { ok: false, error: loadError }
  }
}

export function unloadVosk(): void {
  if (recognizer) {
    recognizer.remove()
    recognizer = null
  }
  if (model) {
    model.terminate()
    model = null
  }
  status = 'unloaded'
  loadError = null
}

// ── Recognition ──────────────────────────────────────────

export interface VoskResult {
  text: string
  inGrammar: boolean
  confidence: number
}

/**
 * Feed audio to Vosk and get grammar-constrained result.
 * Returns the recognized text if it matches grammar, null otherwise.
 */
export function transcribeWithVosk(samples: Float32Array): Promise<VoskResult | null> {
  if (!recognizer || status !== 'ready') return Promise.resolve(null)

  return new Promise((resolve) => {
    let resolved = false

    const onResult = (message: { event: string; result: { text: string; result?: Array<{ conf: number; word: string }> } }) => {
      if (resolved) return
      resolved = true
      cleanup()

      const text = message.result.text.trim()

      // Reject if empty, entirely [unk], or contains [unk] tokens
      // (meaning Vosk heard words outside the grammar)
      if (!text || text.includes('[unk]')) {
        resolve(null)
        return
      }

      // Calculate average confidence from word-level results
      const words = message.result.result ?? []
      const avgConf = words.length > 0
        ? words.reduce((sum, w) => sum + w.conf, 0) / words.length
        : 0.5

      // Low confidence = likely a forced match, fall through to Whisper
      if (avgConf < 0.5) {
        resolve(null)
        return
      }

      resolve({
        text,
        inGrammar: true,
        confidence: avgConf
      })
    }

    const cleanup = () => {
      recognizer?.removeEventListener('result', onResult as EventListener)
    }

    // Set timeout — if Vosk doesn't return in 2s, give up
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        recognizer?.retrieveFinalResult()
        resolve(null)
      }
    }, 2000)

    recognizer!.addEventListener('result', ((msg: CustomEvent) => {
      clearTimeout(timeout)
      onResult(msg.detail ?? msg)
    }) as EventListener)

    // Feed audio
    recognizer!.acceptWaveformFloat(samples, 16000)
    // Request final result
    recognizer!.retrieveFinalResult()
  })
}

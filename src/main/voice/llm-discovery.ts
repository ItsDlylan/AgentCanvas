// ── Local LLM Discovery ──────────────────────────────────
// Probes localhost for Ollama and LM Studio endpoints.
// Returns available models and connection status.

import { net } from 'electron'

export interface LLMEndpoint {
  provider: 'ollama' | 'lm-studio' | 'custom'
  baseUrl: string
  models: string[]
}

export interface LLMDiscoveryResult {
  endpoints: LLMEndpoint[]
  defaultEndpoint: LLMEndpoint | null
}

let cachedResult: LLMDiscoveryResult | null = null

/**
 * Probe localhost for available LLM endpoints.
 * Checks LM Studio (:1234) and Ollama (:11434).
 */
export async function discoverLLMEndpoints(
  manualEndpoint?: string | null,
  manualModel?: string | null
): Promise<LLMDiscoveryResult> {
  const endpoints: LLMEndpoint[] = []

  // Manual override takes priority
  if (manualEndpoint) {
    try {
      const models = await probeOpenAI(manualEndpoint)
      endpoints.push({ provider: 'custom', baseUrl: manualEndpoint, models })
    } catch {
      // Manual endpoint unreachable — still add it but with empty models
      endpoints.push({ provider: 'custom', baseUrl: manualEndpoint, models: manualModel ? [manualModel] : [] })
    }
  }

  // Probe LM Studio (OpenAI-compatible at :1234)
  try {
    const models = await probeOpenAI('http://localhost:1234')
    if (models.length > 0) {
      endpoints.push({ provider: 'lm-studio', baseUrl: 'http://localhost:1234', models })
    }
  } catch { /* not running */ }

  // Probe Ollama (:11434)
  try {
    const models = await probeOllama()
    if (models.length > 0) {
      endpoints.push({ provider: 'ollama', baseUrl: 'http://localhost:11434', models })
    }
  } catch { /* not running */ }

  const result: LLMDiscoveryResult = {
    endpoints,
    defaultEndpoint: endpoints[0] ?? null
  }

  cachedResult = result
  return result
}

export function getCachedDiscovery(): LLMDiscoveryResult | null {
  return cachedResult
}

// ── Probing ──────────────────────────────────────────────

async function probeOpenAI(baseUrl: string): Promise<string[]> {
  const res = await fetchWithTimeout(`${baseUrl}/v1/models`, 3000)
  if (!res.ok) return []
  const json = await res.json()
  return (json.data ?? []).map((m: { id: string }) => m.id)
}

async function probeOllama(): Promise<string[]> {
  const res = await fetchWithTimeout('http://localhost:11434/api/tags', 3000)
  if (!res.ok) return []
  const json = await res.json()
  return (json.models ?? []).map((m: { name: string }) => m.name)
}

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
      reject(new Error('Timeout'))
    }, timeoutMs)

    fetch(url, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timeout)
        resolve(res)
      })
      .catch((err) => {
        clearTimeout(timeout)
        reject(err)
      })
  })
}

// ── Local LLM Router (Tier 3) ────────────────────────────
// Routes complex/compound voice commands via local LLM (Ollama/LM Studio).
// Uses OpenAI-compatible chat API with JSON mode and few-shot examples.
// Only called when Tier 1 (regex) and Tier 2 (Levenshtein) both miss.

import type { VoiceAction, VoiceContext } from './types'

// ── Types ────────────────────────────────────────────────

export interface LLMActionPlan {
  steps: VoiceAction[]
  confirmation: string
  destructive: boolean
}

// ── System Prompt ────────────────────────────────────────

const SYSTEM_PROMPT = `You are the voice command interpreter for AgentCanvas, an infinite canvas app with terminal, browser, note, and draw tiles.

Given a voice transcript and the current canvas state, return a JSON action plan.

Available action types:
- tile.spawnTerminal: { label?: string }
- tile.spawnBrowser: { url?: string }
- tile.spawnNote: {}
- tile.spawnDraw: {}
- tile.closeFocused: {}
- tile.closeByLabel: { label: string }
- tile.rename: { label: string }
- navigate.workspace: { name: string }
- navigate.tile: { label: string }
- navigate.zoom: { direction: "in" | "out" }
- navigate.fitAll: {}
- agent.startClaude: { prompt: string }
- agent.approve: {}
- agent.reject: {}
- agent.interrupt: {}
- agent.sendInput: { text: string }
- agent.tellTo: { target: string, message: string }
- agent.broadcastTo: { target: string, message: string }

Response format (JSON only):
{
  "steps": [{ "type": "action.type", "params": { ... }, "destructive": false }],
  "confirmation": "Human-readable description of what will happen",
  "destructive": true/false
}

If the transcript doesn't seem like a canvas command, return: { "steps": [], "confirmation": "", "destructive": false }

## Examples

Transcript: "set up a code review with three agents for the auth module"
Response:
{"steps":[{"type":"tile.spawnTerminal","params":{"label":"Security Review","command":"claude -p 'Review src/auth for security vulnerabilities'"},"destructive":false},{"type":"tile.spawnTerminal","params":{"label":"Performance Review","command":"claude -p 'Review src/auth for performance issues'"},"destructive":false},{"type":"tile.spawnTerminal","params":{"label":"Test Coverage","command":"claude -p 'Analyze test coverage for src/auth'"},"destructive":false}],"confirmation":"Spawn 3 review agents for auth?","destructive":false}

Transcript: "open a browser to github and a terminal side by side"
Response:
{"steps":[{"type":"tile.spawnBrowser","params":{"url":"https://github.com"},"destructive":false},{"type":"tile.spawnTerminal","params":{},"destructive":false}],"confirmation":"Open browser to GitHub and a terminal?","destructive":false}

Transcript: "close all the note tiles"
Response:
{"steps":[{"type":"tile.closeByLabel","params":{"label":"note"},"destructive":true}],"confirmation":"Close all note tiles?","destructive":true}

Transcript: "rename this to api server and zoom to fit"
Response:
{"steps":[{"type":"tile.rename","params":{"label":"API Server"},"destructive":false},{"type":"navigate.fitAll","params":{},"destructive":false}],"confirmation":"Rename to 'API Server' and fit view?","destructive":false}

Transcript: "tell all the review agents to wrap up and summarize findings"
Response:
{"steps":[{"type":"agent.broadcastTo","params":{"target":"review","message":"wrap up and summarize your findings"},"destructive":true}],"confirmation":"Broadcast to all review agents?","destructive":true}

Transcript: "the weather looks nice today"
Response:
{"steps":[],"confirmation":"","destructive":false}`

// ── LLM Call ─────────────────────────────────────────────

export async function routeViaLLM(
  transcript: string,
  context: VoiceContext
): Promise<LLMActionPlan | null> {
  // Discover endpoint from cached IPC result — auto-discover if cache is empty
  let discovery = await window.voice.getLLMStatus()
  if (!discovery?.defaultEndpoint) {
    console.log('[llm-router] No cached endpoint, running auto-discovery...')
    discovery = await window.voice.discoverLLM()
  }
  if (!discovery?.defaultEndpoint) {
    console.error('[llm-router] No LLM endpoint found — is LM Studio / Ollama running?')
    return null
  }

  const endpoint = discovery.defaultEndpoint
  const model = endpoint.models[0]
  if (!model) {
    console.error('[llm-router] Endpoint found but no models loaded:', endpoint.baseUrl)
    return null
  }

  // Build the API URL based on provider
  const apiUrl = endpoint.provider === 'ollama'
    ? `${endpoint.baseUrl}/api/chat`
    : `${endpoint.baseUrl}/v1/chat/completions`

  const contextSummary = {
    activeWorkspace: context.activeWorkspace,
    focusedTile: context.focusedTileId ? {
      id: context.focusedTileId,
      type: context.focusedTileType,
      label: context.focusedTileLabel
    } : null,
    visibleTiles: context.visibleTiles.map((t) => ({
      type: t.type,
      label: t.label,
      status: t.status
    })),
    tileCount: context.allTiles.length
  }

  const userMessage = `Canvas state: ${JSON.stringify(contextSummary)}\nTranscript: "${transcript}"`

  try {
    const body = endpoint.provider === 'ollama'
      ? {
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage }
          ],
          format: 'json',
          stream: false
        }
      : {
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'action_plan',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  steps: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        params: { type: 'object' },
                        destructive: { type: 'boolean' }
                      },
                      required: ['type', 'params', 'destructive']
                    }
                  },
                  confirmation: { type: 'string' },
                  destructive: { type: 'boolean' }
                },
                required: ['steps', 'confirmation', 'destructive']
              }
            }
          },
          temperature: 0.1
        }

    console.log(`[llm-router] Tier 3 request → ${apiUrl} (model=${model})`)
    console.log(`[llm-router] Transcript: "${transcript}"`)
    console.log(`[llm-router] Context:`, contextSummary)

    const t0 = performance.now()

    // Route through main process IPC to avoid CORS
    const res = await window.voice.chatLLM(apiUrl, body)
    const elapsed = Math.round(performance.now() - t0)

    if (!res.ok) {
      console.error(`[llm-router] HTTP ${res.status ?? ''} ${res.error ?? 'unknown error'} (${elapsed}ms)`)
      return null
    }

    const json = res.data as Record<string, unknown>

    // Extract content based on provider format
    const content = endpoint.provider === 'ollama'
      ? (json.message as Record<string, unknown>)?.content
      : ((json.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>)?.content

    if (!content) {
      console.error(`[llm-router] No content in response (${elapsed}ms):`, JSON.stringify(json).slice(0, 500))
      return null
    }

    console.log(`[llm-router] Raw LLM response (${elapsed}ms):`, content)

    const plan = JSON.parse(content) as LLMActionPlan
    if (!plan.steps || !Array.isArray(plan.steps)) {
      console.error('[llm-router] Invalid plan — missing steps array:', content)
      return null
    }
    if (plan.steps.length === 0) {
      console.log('[llm-router] Empty plan — LLM says not a command')
      return null
    }

    // Ensure each step has the required fields
    for (const step of plan.steps) {
      if (!step.type) {
        console.error('[llm-router] Step missing type:', step)
        return null
      }
      if (!step.params) step.params = {}
      if (step.destructive === undefined) step.destructive = false
    }

    console.log(`[llm-router] Plan accepted (${plan.steps.length} steps, ${elapsed}ms):`, plan.confirmation)
    return plan
  } catch (err) {
    console.error('[llm-router] Failed:', err instanceof Error ? err.message : err)
    return null
  }
}

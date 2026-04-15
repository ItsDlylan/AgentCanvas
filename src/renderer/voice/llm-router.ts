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
  // Discover endpoint from cached IPC result
  const discovery = await window.voice.getLLMStatus()
  if (!discovery?.defaultEndpoint) return null

  const endpoint = discovery.defaultEndpoint
  const model = endpoint.models[0]
  if (!model) return null

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
          response_format: { type: 'json_object' },
          temperature: 0.1
        }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    clearTimeout(timeout)
    if (!res.ok) return null

    const json = await res.json()

    // Extract content based on provider format
    const content = endpoint.provider === 'ollama'
      ? json.message?.content
      : json.choices?.[0]?.message?.content

    if (!content) return null

    const plan = JSON.parse(content) as LLMActionPlan
    if (!plan.steps || !Array.isArray(plan.steps)) return null
    if (plan.steps.length === 0) return null

    // Ensure each step has the required fields
    for (const step of plan.steps) {
      if (!step.type) return null
      if (!step.params) step.params = {}
      if (step.destructive === undefined) step.destructive = false
    }

    return plan
  } catch {
    return null
  }
}

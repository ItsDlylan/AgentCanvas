# AgentCanvas

Infinite canvas Electron app for spawning terminal and browser tiles side by side.

## For Claude Code instances running inside AgentCanvas terminals

Every terminal has these environment variables:

- **`AGENT_CANVAS_API`** — Local HTTP API for spawning/managing browser tiles on the canvas
- **`AGENT_BROWSER_CDP_PORT`** — Pre-allocated CDP port for controlling the canvas browser tile

### When the user asks to browse, research, or test a website:

Use `/agent-canvas-agent-browser` instead of `/agent-browser`. This routes the browser through a canvas tile so the user can see and interact with it.

If that skill is not available, the manual workflow is:

```bash
# 1. Spawn a browser tile on the canvas
curl -s -X POST $AGENT_CANVAS_API/api/browser/open \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://target-site.com"}'
sleep 2

# 2. Control it via CDP
agent-browser --cdp $AGENT_BROWSER_CDP_PORT snapshot -i
agent-browser --cdp $AGENT_BROWSER_CDP_PORT click @e1
```

**Do NOT use `Fetch()` or `WebSearch()` when the user asks you to browse a website** — use the canvas browser tile so they can see what you're doing.

### Notifications

Send a toast notification to the AgentCanvas UI:

```bash
curl -s -X POST $AGENT_CANVAS_API/api/notify \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Task Complete\",\"body\":\"Finished refactoring\",\"level\":\"success\",\"terminalId\":\"$AGENT_CANVAS_TERMINAL_ID\"}"
```

Levels: `info` (default), `success`, `warning`, `error`. Error notifications are sticky (no auto-dismiss).

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

### Spawning terminal tiles (agent orchestration)

Spawn a worker terminal tile linked to the current terminal. The new tile appears in a radial fan layout with a purple edge connecting it to the source terminal.

```bash
curl -s -X POST $AGENT_CANVAS_API/api/terminal/spawn \
  -H 'Content-Type: application/json' \
  -d "{
    \"label\": \"Security Reviewer\",
    \"cwd\": \"$(pwd)\",
    \"command\": \"claude -p 'Review src/auth for vulnerabilities'\",
    \"linkedTerminalId\": \"$AGENT_CANVAS_TERMINAL_ID\",
    \"metadata\": {
      \"team\": { \"role\": \"security-reviewer\", \"teamName\": \"code-review\" }
    }
  }"
```

Parameters:
- **`label`** — Tile name displayed in the header
- **`cwd`** — Working directory for the new terminal
- **`command`** — Command to auto-run after the shell initializes
- **`linkedTerminalId`** — Source terminal ID for edge + radial positioning
- **`width`** / **`height`** — Tile dimensions (default 640x400)
- **`metadata`** — Arbitrary metadata; `metadata.team` enables team visual styling (purple ring, role badge)

Write to an existing terminal:

```bash
curl -s -X POST $AGENT_CANVAS_API/api/terminal/write \
  -H 'Content-Type: application/json' \
  -d "{\"terminalId\": \"<id>\", \"data\": \"ls -la\\n\"}"
```

### Note tiles

Create, read, update, and delete note tiles on the canvas. Content accepts **markdown strings** (auto-converted) or raw TipTap JSON.

```bash
# Create a note tile
curl -s -X POST $AGENT_CANVAS_API/api/note/open \
  -H 'Content-Type: application/json' \
  -d "{
    \"label\": \"Architecture Notes\",
    \"content\": \"# Overview\n\n- Service A handles auth\n- Service B handles billing\",
    \"linkedTerminalId\": \"$AGENT_CANVAS_TERMINAL_ID\"
  }"
# Returns: { "ok": true, "noteId": "<uuid>" }

# Read a note (returns metadata, TipTap JSON content, and markdown)
curl -s -X POST $AGENT_CANVAS_API/api/note/read \
  -H 'Content-Type: application/json' \
  -d '{"noteId":"<id>"}'

# Update note content
curl -s -X POST $AGENT_CANVAS_API/api/note/update \
  -H 'Content-Type: application/json' \
  -d '{"noteId":"<id>","content":"# Updated Content\n\nNew text here."}'

# Rename a note (uses the generic tile rename endpoint)
curl -s -X POST $AGENT_CANVAS_API/api/tile/rename \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"<id>","label":"New Name"}'

# List all notes
curl -s $AGENT_CANVAS_API/api/notes

# Soft delete (removes from canvas, keeps file)
curl -s -X POST $AGENT_CANVAS_API/api/note/close \
  -H 'Content-Type: application/json' \
  -d '{"noteId":"<id>"}'

# Hard delete (removes from canvas and disk)
curl -s -X POST $AGENT_CANVAS_API/api/note/delete \
  -H 'Content-Type: application/json' \
  -d '{"noteId":"<id>"}'
```

Parameters for `note/open`:
- **`label`** — Note title (default: auto-generated)
- **`content`** — Markdown string or TipTap JSON object
- **`linkedTerminalId`** — Link to a terminal (green edge, positions adjacent)
- **`linkedNoteId`** — Link to a parent note (amber edge)
- **`position`** — `{ x, y }` canvas coordinates
- **`width`** / **`height`** — Tile dimensions (default 400x400)

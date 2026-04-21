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

### Task tiles

Task tiles are first-class "thing to do" containers that agents can read and write. Each task has a required **classification** (`QUICK`, `NEEDS_RESEARCH`, `DEEP_FOCUS`, `BENCHMARK`), an optional **timeline pressure** (`urgent`, `this-week`, `this-month`, `whenever`), and a **derived state** computed from linked artifacts (`raw` → `researched` → `planned` → `executing` → `review` → `done`).

```bash
# Create a task (classifier proposes a classification if you don't supply one)
curl -s -X POST $AGENT_CANVAS_API/api/task/open \
  -H 'Content-Type: application/json' \
  -d "{
    \"label\": \"Add audit logging\",
    \"intent\": \"Track who modified each record\",
    \"acceptanceCriteria\": \"- [ ] All writes log user_id + timestamp\",
    \"workspaceId\": \"agentcanvas\"
  }"
# Returns: { "ok": true, "taskId": "<uuid>", "classification": "QUICK", ... }

# Read a task (returns meta + intent markdown + acceptanceCriteria TipTap + derived state)
curl -s -X POST $AGENT_CANVAS_API/api/task/read \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"<id>"}'

# Update fields (classification, timeline, label, intent, acceptanceCriteria, manualReviewDone)
curl -s -X POST $AGENT_CANVAS_API/api/task/update \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"<id>","classification":"DEEP_FOCUS","timelinePressure":"this-week"}'

# Classify intent text via heuristics + LLM fallback (does not modify the task)
curl -s -X POST $AGENT_CANVAS_API/api/task/classify \
  -H 'Content-Type: application/json' \
  -d '{"intent":"Investigate slow query"}'

# Attach a typed edge (kinds: has-plan | executing-in | research-output | linked-pr | depends-on)
curl -s -X POST $AGENT_CANVAS_API/api/task/link \
  -H 'Content-Type: application/json' \
  -d '{"sourceTaskId":"<task>","targetId":"<plan|terminal|note|task>","kind":"has-plan"}'

# Compute derived state (raw | researched | planned | executing | review | done)
curl -s -X POST $AGENT_CANVAS_API/api/task/state-derive \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"<id>"}'

# Convert an existing note tile to a task (note is soft-closed)
curl -s -X POST $AGENT_CANVAS_API/api/task/convert-from-note \
  -H 'Content-Type: application/json' \
  -d '{"noteId":"<note-id>","classification":"QUICK","timelinePressure":"this-week"}'

# Bulk classify every open note (returns proposals — does not convert)
curl -s -X POST $AGENT_CANVAS_API/api/task/review-all

# List tasks with filters (any of classification, state, timeline, workspaceId, includeDone)
curl -s "$AGENT_CANVAS_API/api/tasks?classification=QUICK&state=raw&workspaceId=agentcanvas"

# Soft-close (auto-swept after 7 days; recoverable before that)
curl -s -X POST $AGENT_CANVAS_API/api/task/close \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"<id>"}'

# Hard delete
curl -s -X POST $AGENT_CANVAS_API/api/task/delete \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"<id>"}'
```

**Derived state rules:**
- `QUICK` / `BENCHMARK`: `raw` (no linked terminal) → `executing` (terminal running) → `review` (terminal exited) → `done` (human marks reviewed)
- `NEEDS_RESEARCH` / `DEEP_FOCUS`: `raw` → `researched` (research-output edge to a note) → `planned` → `executing` → `review` (all three follow the linked Plan Tile's state) → `done`

Agents inside a terminal linked to a task can spawn subtasks with a `depends-on` edge to track discovered work. The `→review` transition fires a success-level `/api/notify` toast automatically.

### ⌘K palette task tokens

In the command palette, task tiles can be filtered inline:
- `!class:QUICK` / `!class:NEEDS_RESEARCH` / `!class:DEEP_FOCUS` / `!class:BENCHMARK`
- `!state:raw` / `!state:researched` / `!state:planned` / `!state:executing` / `!state:review` / `!state:done`
- `!when:urgent` / `!when:this-week` / `!when:this-month` / `!when:whenever`

Tokens can be combined with workspace (`@workspace`) or plain text search. The Task Lens sidebar (`Cmd+Shift+T`) exposes 4 built-in views: Morning Quick Burst, This Week Deep Focus, Needs-Research Inbox, In Flight.

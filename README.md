# AgentCanvas

An infinite canvas Electron app for spawning terminal and browser tiles side by side. Built for running multiple Claude Code instances (or any terminal-based agents) with full browser control via Chrome DevTools Protocol.

<!-- Add a hero screenshot of the full canvas with terminals and browsers open -->
![AgentCanvas Screenshot](docs/screenshots/canvas-overview.png)

## Download

Download the latest release for macOS from the [Releases page](https://github.com/ItsDlylan/AgentCanvas/releases).

> **Note:** The app is not code-signed. On first launch, right-click the app and select **Open**, then click **Open** again in the dialog.

## Features

### Terminal Tiles
Real PTY sessions powered by node-pty with GPU-accelerated rendering via xterm.js WebGL. Each terminal tracks its status (idle/running/waiting), current working directory, and foreground process. Terminals persist across app restarts — positions, metadata, and scrollback are saved on quit and replayed on launch so you pick up right where you left off. Double-click to rename. Open the terminal's working directory in your IDE with a single click or hotkey.

<!-- Screenshot: a few terminal tiles on the canvas -->
![Terminal Tiles](docs/screenshots/terminal-tiles.png)

### Browser Tiles
Embedded browser tiles live on the canvas alongside terminals. Navigate, go back/forward, reload, and resize — all inline. Device preset emulation is built in (iPhone 15, iPad, Pixel 8, Desktop HD, Full HD, Responsive, etc.). Browser tiles stay mounted across workspace switches so agent CDP connections aren't interrupted.

<!-- Screenshot: browser tile with device preset selector -->
![Browser Tiles](docs/screenshots/browser-tiles.png)

### Notes Tiles
Rich text notes powered by TipTap with markdown, headings, lists, task lists, blockquotes, and code blocks. Notes link to terminals or other notes via canvas edges and persist to disk automatically with 500ms debounced saves. Checklist mode supports task lists with checkboxes that integrate with the Pomodoro timer. Export to Markdown or JSON. Soft-close hides a note without deleting it; hard-delete removes it permanently.

### Draw Tiles
A full drawing canvas with Konva for shapes and freehand rendering. Tools include rectangle, circle, ellipse, freehand drawing with pressure sensitivity, arrows with smart binding to shapes, and a selection tool for editing. Shapes render with a hand-drawn RoughJS aesthetic and support stroke/fill color picking. Grid snapping (20px, toggleable), pan and zoom, undo/redo with 50-step history, and JSON export/import. Import Mermaid diagrams directly via a built-in dialog. Horizontal bottom toolbar with SVG icons.

### Diff Viewer Tiles
Git-aware diff visualization powered by @git-diff-view/react. Linked to a terminal tile for automatic worktree detection — shows file changes (added, modified, deleted, renamed) with syntax-highlighted diffs. Supports split and unified view modes with refresh capability. Language detection for 30+ languages.

### DevTools Tiles
Chrome DevTools Inspector tiles that attach to any browser tile on the canvas. Live WebSocket connection via CDP gives you the element picker, styles panel, console, and everything else from Chrome's inspector — right on the canvas alongside the browser it's inspecting.

### Workspaces
Organize tiles into project-scoped workspaces. Each workspace maintains its own set of tiles and viewport position. Browser tiles persist across workspace switches with CDP keepalive. Option-hold shows jump hints (1-9, A-Z) to instantly focus any tile in the active workspace.

<!-- Screenshot: workspace panel -->
![Workspaces](docs/screenshots/workspaces.png)

### Process Panel
A sidebar listing all active tiles with real-time status indicators and quick controls — focus, kill, rename, or spawn new tiles. Tiles group hierarchically: parent terminals with child terminals, linked browsers, notes, and diffs nested underneath. Spawn from 6 terminal size presets, 7 browser device presets, or saved workspace templates (3 built-in: Frontend Dev, Research, Multi-terminal).

<!-- Screenshot: process panel sidebar -->
![Process Panel](docs/screenshots/process-panel.png)

### Pomodoro Timer
A global Pomodoro timer with configurable focus (25m), short break (5m), and long break (15m) durations. Tracks sessions with automatic phase cycling. Add tasks manually or extract them from note checklists — task completion syncs back to the linked note. Compact titlebar badge shows a circular progress ring; expand for the full timer widget. Sound notification on phase completion. Cross-workspace task visibility. Toggle with `Mod+P`.

### Tile Edges
Draw edges between tiles to show relationships. Edges persist across restarts and render in the minimap. Useful for linking terminals to their associated browsers, notes, or diff viewers.

### Canvas Backgrounds
Nine animated background modes beyond the default dot grid:

- **Matrix** — Falling green characters
- **Starfield** — Parallax star field
- **Circuit** — Circuit board pattern
- **Topographic** — Contour line map
- **Ocean** — Animated waves
- **Constellation** — Connected star network
- **Fireflies** — Glowing floating particles
- **Snow** — Falling snowflakes

Configurable via Settings > Canvas.

### IDE Integration
Open any terminal's working directory in your IDE with a button click or `Mod+Shift+O`. Supports Cursor, VS Code, Zed, Sublime Text, IntelliJ, WebStorm, Nova, and Fleet. Configurable in Settings > General.

### Settings
Fully configurable via a built-in settings page (`Mod+,`):

- **General** — Shell, default working directory, IDE command
- **Appearance** — Terminal font family/size/line height, cursor style and blink
- **Terminal** — Scrollback buffer size, custom environment variables
- **Browser** — Default URL, default device preset
- **Canvas** — Tile gap, zoom range, background mode, background dot styling, pan speed, minimap position
- **Hotkeys** — Rebind every action with a visual key recorder
- **Templates** — Save and load tile layouts (3 built-in: Frontend Dev, Research, Multi-terminal)
- **Notifications** — Toggle in-app toasts, sound chime, and native OS notifications when unfocused

All settings live-apply — changes reflect immediately in open terminals and UI without restart.

### Canvas API
A local HTTP API server lets agents in terminals programmatically spawn and control tiles, set terminal metadata, and query canvas state. Every terminal gets the API endpoint injected as `AGENT_CANVAS_API`.

### CDP Proxy
A two-phase Chrome DevTools Protocol proxy gives agents full browser automation. The port is pre-allocated and injected as `AGENT_BROWSER_CDP_PORT` before the browser even loads, eliminating race conditions between browser spawn and agent connection. Commands queue during attach and flush once the debugger connects.

### Terminal Metadata API
A generic key-value store on each terminal session, settable via `POST /api/terminal/metadata`. Used for worktree integration (branch name, path, URL, database), parent-child grouping, and auto-discovery by browser automation skills. Metadata persists across restarts alongside the terminal tile.

### Notifications
Agents in terminal tiles can post toast notifications to the canvas via `POST /api/notify`. Toasts stack in the bottom-right corner with level-based styling (`info`, `success`, `warning`, `error`), play a Web Audio chime, and can be clicked to focus the originating terminal tile. When the AgentCanvas window is unfocused, the main process also fires a native OS notification so long-running tasks can pull you back. Includes a bundled installer (`npm run setup:claude-hook`) that wires the endpoint into Claude Code's Stop hook so finished tasks notify the canvas automatically.

## Keyboard Shortcuts

All shortcuts are rebindable in Settings > Hotkeys.

| Shortcut | Action |
|---|---|
| `Mod+T` | New terminal |
| `Mod+B` | New browser |
| `Mod+N` | New note |
| `Mod+Shift+D` | New draw tile |
| `Mod+D` | Kill focused tile (hold Cmd for red pulse preview) |
| `Mod+\` | Toggle Process Panel |
| `Mod+Shift+\` | Toggle Workspace Panel |
| `Mod+M` | Toggle Minimap |
| `Mod+,` | Open Settings |
| `Mod+P` | Toggle Pomodoro Timer |
| `Mod+Shift+O` | Open in IDE |
| `Ctrl+Tab` | Cycle focus forward |
| `Ctrl+Shift+Tab` | Cycle focus backward |
| `Option-hold` | Show workspace jump hints |

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- npm

### Install

```bash
git clone <repo-url>
cd AgentCanvas
npm install
```

### Run (Development)

```bash
npm run dev
```

### Build

```bash
npm run build
npm run preview  # preview the production build
```

### Package (macOS DMG)

```bash
npm run dist:mac
```

This creates a DMG installer in `dist/`. To upload a release to GitHub:

```bash
git tag v0.1.0
git push origin --tags
gh release create v0.1.0 dist/*.dmg --title "AgentCanvas v0.1.0" --notes "Initial release"
```

### Optional: Claude Code Notification Hooks

If you use Claude Code, install the bundled notification hooks so any Claude Code instance running inside an AgentCanvas terminal tile automatically posts toasts to the canvas on notable events:

```bash
npm run setup:claude-hook
```

Two hooks are installed:

- **Stop hook** — posts a success toast when Claude finishes a task, so you can glance at the canvas to see which tile is done.
- **AskUserQuestion hook** — posts a warning toast when Claude invokes the `AskUserQuestion` tool mid-turn and is blocked waiting on your input. Without this, the picker UI appears silently and it's easy to miss that a tile needs you.

This installer is idempotent — safe to re-run — and:

- Copies `scripts/agentcanvas-notify-stop.sh` and `scripts/agentcanvas-notify-ask-user.sh` to `~/.claude/scripts/`
- Registers a `Stop` hook command and a `PreToolUse` hook command (matcher `AskUserQuestion`) in `~/.claude/settings.json` (backing up the existing file with a timestamped suffix on any run that makes changes)
- Leaves any other hooks you have configured untouched

Both hook scripts are no-ops outside AgentCanvas (they check for the `AGENT_CANVAS_API` env var), so installing them globally has zero effect on Claude Code instances running in any other terminal. The `AskUserQuestion` hook backgrounds its network call so Claude's picker UI isn't delayed by a slow canvas server. Honors the `CLAUDE_CONFIG_DIR` env var if you keep your Claude config in a non-default location. Requires `python3` (preinstalled on macOS).

## Architecture

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # App lifecycle, IPC handlers, PTY batching
│   ├── terminal-manager.ts  # PTY session management, status polling
│   ├── browser-manager.ts   # Browser session registry
│   ├── browser-store.ts     # Browser tile persistence
│   ├── cdp-proxy.ts         # Two-phase CDP proxy with command queuing
│   ├── canvas-api.ts        # Local HTTP API server
│   ├── terminal-store.ts    # Terminal tile persistence across restarts
│   ├── workspace-store.ts   # Workspace state persistence
│   ├── note-store.ts        # Note file I/O
│   ├── note-converter.ts    # Note format conversion (Markdown, JSON)
│   ├── draw-store.ts        # Draw tile persistence
│   ├── edge-store.ts        # Tile edge/connection persistence
│   ├── diff-service.ts      # Git diff computation for diff viewer
│   ├── settings-store.ts    # Settings with deep merge defaults
│   ├── pomodoro-store.ts    # Pomodoro timer state persistence
│   └── perf-monitor.ts      # Runtime performance measurement
├── renderer/                # React UI
│   ├── components/
│   │   ├── Canvas.tsx       # Infinite canvas (React Flow), tile spawning, persistence
│   │   ├── TerminalTile.tsx # xterm.js tile with status badge and metadata display
│   │   ├── BrowserTile.tsx  # Webview with device presets and CDP attachment
│   │   ├── NotesTile.tsx    # TipTap rich text editor
│   │   ├── draw/            # Draw tile: DrawTile, DrawCanvas, MermaidDialog, shapes
│   │   ├── DiffViewerTile.tsx # Git diff viewer with syntax highlighting
│   │   ├── DevToolsTile.tsx # Chrome DevTools inspector panel
│   │   ├── PomodoroWidget.tsx # Global Pomodoro timer with task management
│   │   ├── ProcessPanel.tsx # Hierarchical tile list with grouping
│   │   ├── WorkspacePanel.tsx # Workspace switcher
│   │   ├── SettingsPage.tsx # Settings UI with 8 categories
│   │   ├── NotificationToast.tsx # Stacking toast overlay for /api/notify events
│   │   ├── CanvasBackground.tsx # Animated background renderer
│   │   ├── backgrounds/     # 8 animated canvas backgrounds
│   │   ├── OffscreenIndicators.tsx # Off-screen tile direction arrows
│   │   └── PerformanceOverlay.tsx  # Runtime perf stats
│   ├── hooks/               # useTerminal, useBrowser, useNotes, useHotkeys, etc.
│   └── types/               # TypeScript interfaces
└── preload/                 # IPC bridge (context isolation)
    └── index.ts             # terminal, browser, workspace, note, settings, terminalTiles APIs
```

**Main process** manages PTY sessions, browser state, the CDP proxy, and the Canvas API HTTP server. PTY output is batched at 4ms intervals to prevent IPC flooding. Terminal tiles and their scrollback persist to `terminals.json` on shutdown.

**Renderer** uses [React Flow](https://reactflow.dev/) for the infinite canvas and xterm.js for terminal rendering. Terminals snapshot during pan to avoid cascading re-renders.

**Preload** bridges main <> renderer via context-isolated IPC, exposing `window.terminal`, `window.browser`, `window.workspace`, `window.note`, `window.settings`, and `window.terminalTiles` APIs.

## Canvas API

Agents running inside terminals can control the canvas via the HTTP API at `$AGENT_CANVAS_API`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/browser/open` | POST | Spawn a browser tile (returns CDP port) |
| `/api/browser/navigate` | POST | Navigate an existing browser |
| `/api/browser/resize` | POST | Resize a browser tile |
| `/api/browser/close` | POST | Close a browser tile |
| `/api/terminal/metadata` | POST | Set key-value metadata on a terminal |
| `/api/tile/rename` | POST | Rename any tile |
| `/api/draw/open` | POST | Spawn a draw tile from a terminal |
| `/api/draw/update` | POST | Update a draw tile with Mermaid or elements |
| `/api/notify` | POST | Post a toast notification to the canvas |
| `/api/status` | GET | List all terminals and browsers with metadata |

### Example: Spawn a browser from a terminal agent

```bash
curl -s -X POST $AGENT_CANVAS_API/api/browser/open \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}'
```

### Example: Set worktree metadata on a terminal

```bash
curl -s -X POST $AGENT_CANVAS_API/api/terminal/metadata \
  -H 'Content-Type: application/json' \
  -d "{\"terminalId\":\"$AGENT_CANVAS_TERMINAL_ID\",\"key\":\"worktree\",\"value\":{\"branch\":\"feat/my-feature\",\"path\":\"/tmp/worktrees/my-feature\"}}"
```

### Example: Post a toast notification from a terminal agent

```bash
curl -s -X POST $AGENT_CANVAS_API/api/notify \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Build complete\",\"body\":\"All tests passed\",\"level\":\"success\",\"terminalId\":\"$AGENT_CANVAS_TERMINAL_ID\"}"
```

Levels: `info` (default), `success`, `warning`, `error`. Errors are sticky (no auto-dismiss); other levels auto-dismiss after a level-specific timeout. Including `terminalId` makes the toast click-to-focus the originating tile.

## Environment Variables

Every terminal spawned on the canvas gets these injected automatically:

| Variable | Description |
|---|---|
| `AGENT_CANVAS_API` | Local HTTP API endpoint for canvas control |
| `AGENT_BROWSER_CDP_PORT` | Pre-allocated CDP port for browser automation |
| `AGENT_CANVAS_TERMINAL_ID` | Unique ID for the terminal session |
| `TERM_PROGRAM` | Set to `AgentCanvas` |

Plus custom environment variables configured in Settings > Terminal.

## Persistence

| Data | Location | Strategy |
|---|---|---|
| Terminal tiles | `~/.config/AgentCanvas/agentcanvas/terminals.json` | Saved on quit with position, size, cwd, metadata, and scrollback. Restored on launch with full scrollback replay. |
| Browser tiles | `~/.config/AgentCanvas/agentcanvas/browsers.json` | Saved on change with position, size, URL, device preset, and linked terminal. |
| Workspaces | `~/.config/AgentCanvas/agentcanvas/workspaces.json` | Saved on change. |
| Settings | `~/.config/AgentCanvas/agentcanvas/settings.json` | Saved on change with deep merge defaults. |
| Notes | `~/AgentCanvas/tmp/note-{id}.json` | Auto-saved with 500ms debounce. |
| Draw tiles | `~/.config/AgentCanvas/agentcanvas/draws.json` | Elements and camera state persisted. |
| Edges | `~/.config/AgentCanvas/agentcanvas/edges.json` | Tile connections persisted on change. |
| Pomodoro | `~/.config/AgentCanvas/agentcanvas/pomodoro.json` | Timer state and task list persisted globally. |

## Tech Stack

- **Electron 35** — Desktop shell
- **React 19** + **TypeScript 5.8** — UI
- **React Flow 12.6** — Infinite canvas
- **xterm.js 5.5** + WebGL addon — GPU-accelerated terminal rendering
- **node-pty 1.1** — Native PTY sessions
- **TipTap 3.22** — Rich text editor for notes
- **Konva** + **RoughJS** — Draw canvas with hand-drawn aesthetic
- **@git-diff-view/react** — Syntax-highlighted diff viewer
- **Tailwind CSS v4** — Styling
- **electron-vite** — Build tooling
- **ws** — WebSocket server for CDP proxy

## Performance

- GPU rasterization and zero-copy via Electron flags
- WebGL-accelerated terminal rendering (no CPU rasterization during pan)
- Batched PTY output (4ms flush interval)
- Terminal snapshots during canvas pan
- Passive event listeners for smooth scrolling
- Status updates throttled: per-tile immediate, bulk panel at 300ms
- Optional runtime performance monitor with FPS, frame times, and render counts

## Changelog

### 2026-04-21

- **feat:** Task Tile — first-class "thing to do" containers with a required classification (`QUICK`, `NEEDS_RESEARCH`, `DEEP_FOCUS`, `BENCHMARK`), optional timeline pressure (`urgent`/`this-week`/`this-month`/`whenever`), and state derived automatically from linked artifacts (`raw` → `researched` → `planned` → `executing` → `review` → `done`). Ships with a full `/api/task/*` CRUD API, ⌘K palette tokens (`!class:`, `!state:`, `!when:`), a Task Lens sidebar (`Cmd+Shift+T`) with 4 built-in views, note-to-task conversion, bulk classify, and `depends-on` subtasks
- **feat:** Plan Tile — structured, versioned, independently-critiqued, executable plans captured from Claude Code's `ExitPlanMode`. Plans are first-class canvas artifacts with a state machine (`draft` → `under_critique` → `verified`/`needs_revision` → `approved` → `executing` → `done`). A fresh-context verifier agent spawns to critique the plan in isolation; an approved plan is handed to an executor agent as a contract with live per-step progress, deviation halts, resume-after-crash, and auto-`done` on linked PR merge
- **feat:** In-app updater — polls GitHub Releases on launch and every 4 hours, surfaces an "Update available" banner with a changelog modal and download progress, verifies downloads against `latest-mac.yml` SHA512, and reveals the DMG in Finder for drag-install. New Settings → Updates section with version display, "Check now", and toggles for launch/periodic checks; adds `npm run release` for one-command electron-builder publishing
- **feat:** In-app Tutorials / How-Tos overlay — a browsable library of tutorial videos and walkthroughs accessible from inside the app, with tag-based filtering so users can narrow to the feature area they're learning about
- **feat:** Cinematic Welcome composition — a 20-second Remotion intro video with four scenes: a 3D-orbit starfield zoom, a wireframe workflow globe, a 5-second CanvasDive into a matrix-rain backdrop, and an outro that holds at full opacity on the final frame. Replaces the earlier sliding/Ignition prototype
- **feat:** User-saveable Task Lens views — save any combination of classification/state/timeline filters as a named custom lens alongside the 4 built-in views
- **feat:** TipTap-powered task acceptance criteria — rich checklist editing inside the task tile instead of plain markdown
- **feat:** In-app React reclassify modal — replaces the native system dialog when changing a task's classification
- **feat:** Soft-block warning for unresolved task dependencies — a task with `depends-on` edges pointing at non-`done` work now surfaces a visible block indicator instead of silently executing
- **fix:** Stabilize Claude Code prompt-cache TTL detection on busy TTYs — the JSONL tailer now reliably picks up `cache_creation.ephemeral_*` tokens even while the log file is churning
- **fix:** Task IPC save now emits `task-close` and `task-update` events so the canvas updates in real time instead of waiting for a manual refresh
- **fix:** Cache-bust tutorial mp4 and jpg URLs so updated tutorial assets load immediately instead of serving stale cached versions

### 2026-04-19

- **feat:** ⌘K tile palette — fuzzy-jump to any tile by label and search through terminal scrollback in a single command bar; pick a result to focus the tile and jump to the match
- **feat:** Flow-mute — while a tile is focused, notifications from other tiles stay silent so you can stay heads-down; the titlebar shows a mute indicator and queued toasts surface the moment focus shifts away
- **feat:** AskUserQuestion canvas notification — Claude Code's `AskUserQuestion` tool now fires a warning toast on the canvas the instant a tile is blocked on your input, so you don't miss a silently-appearing picker; ships with a `PreToolUse` hook in the bundled installer

### 2026-04-18

- **feat:** Image support for note tiles — drag-and-drop images directly into a note, with a hover toolbar for quick actions and automatic attachment garbage collection that cleans up orphaned files when notes are edited or deleted
- **feat:** `Cmd+0` hotkey to zoom and center the viewport on the currently focused tile — one shortcut to snap back from any zoom level
- **fix:** Cross-workspace notification clicks now switch to the originating workspace before focusing the tile, instead of silently failing when the tile lives elsewhere
- **fix:** Renderer no longer crashes when agents POST notes rapidly with large markdown payloads — the pipeline now chunks and debounces conversion work
- **fix:** Note tile bullets and numbered list markers now align properly with their list item text

### 2026-04-15

- **feat:** Claude Code prompt cache TTL timer on terminal tiles — counts down to cache expiry with warning + expiry notifications and an optional auto keep-alive with a per-session cap; links to Anthropic's prompt caching docs
- **feat:** Real prompt-cache TTL detection from Claude Code JSONL logs — tails `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` and reads `cache_creation.ephemeral_{5m,1h}_input_tokens` to distinguish 5-minute vs 1-hour cache served by Anthropic
- **feat:** Pin the log watcher to a specific Claude session via PID registry — resolves the session UUID through `~/.claude/sessions/<pid>.json` so two terminals running Claude in the same cwd no longer cross-wire
- **feat:** Claude Code usage widget in the titlebar — live subscription-usage readout
- **feat:** Dictation stream mode — say "start dictation" to open a floating composer panel that streams transcribed words in real-time as you speak, with VAD-aware chunking (7s max), 2s overlap, and LCS deduplication at chunk boundaries
- **feat:** Edit-before-send workflow — after dictation completes (3s silence or manual stop), transcript becomes an editable textarea for correcting misrecognized words before routing to the LLM
- **feat:** Inline confirmation panel — after sending, the panel shows what the AI heard alongside the planned actions with Y/N keyboard shortcuts, replacing the small top-center pill for dictation flows
- **feat:** Whisper model selection via IPC — transcribe calls now forward an optional model parameter, dictation stream uses the `base` model (~23% lower WER than tiny)
- **feat:** Tier 3 LLM voice routing via local Qwen + coding vocabulary corrections (multi-word: "a p i" → "api", "cube control" → "kubectl"; single-word: "off" → "auth", "jason" → "json")
- **feat:** Recommended LLM models list in voice settings to steer users toward known-good local models
- **feat:** Agent selection wizard for terminal spawning — pick a predefined agent role from a wizard when creating a new terminal tile
- **feat:** Project-specific templates with command execution and interactive layout editor
- **feat:** Image drag-and-drop into terminal tiles and a new ImageTile canvas tile
- **feat:** Note tile CRUD API — `POST /api/note/{open,read,update,close,delete}` so coding agents can create and edit canvas notes programmatically
- **feat:** Persist and restore the last running process across terminal restarts
- **fix:** Split programmatic PTY writes so keep-alive and voice-submitted messages actually submit — Claude Code's TUI treats multi-byte PTY reads as bracketed paste, which turns `\r` into a literal newline; writing the text, waiting 30ms, then writing `\r` alone makes it register as a real Enter keystroke
- **fix:** Voice activation only triggers on wake word or push-to-talk (prevents ambient noise from triggering commands)
- **fix:** Wake word detection tuning — sliding window 3/5 hits, 3s debounce, VAD timing improvements, and listening countdown timer
- **fix:** Avoid an unnecessary `getUserMedia` call when opening voice settings
- **fix:** Auto-mark notifications read when a terminal tile gains focus
- **fix:** Clear the image-drop preview when dragging over tile nodes
- **fix:** Don't claim Cache TTL is tied to plan tier — the TTL is chosen per-request by Claude Code, not by the account tier
- **refactor:** Drop the "Assumed Cache TTL" setting in favour of log-based detection; settings UI now explains where the detected TTL comes from

### 2026-04-14

- **feat:** Full voice command system (M1–M12) — push-to-talk, wake word ("hey jarvis"), and always-on activation modes with Silero VAD for speech boundary detection
- **feat:** Whisper.cpp STT — auto-downloads models to `~/.agentcanvas/models/`, supports tiny/base/small, runs via direct binary invocation with audio normalization
- **feat:** Three-tier command routing — Tier 1: 140+ regex patterns (<50ms), Tier 2: Levenshtein fuzzy matching (<5ms), Tier 3: local LLM via Ollama/LM Studio (1–5s)
- **feat:** Voice-driven tile management — spawn/close/rename terminals, browsers, notes, and draw tiles by voice
- **feat:** Voice navigation — workspace switching, tile focus by label, zoom controls, number overlay for tile selection, 3x3 grid for viewport panning
- **feat:** Multi-agent voice control — approve/reject/interrupt agents, send input to specific tiles, broadcast messages to agent groups by role or team
- **feat:** Wake word detection — openWakeWord ONNX pipeline (mel spectrogram → embedding → classifier) with hey_jarvis, alexa, hey_mycroft models
- **feat:** Vosk grammar fast path — grammar-constrained recognition (~200ms) with automatic Whisper fallback for out-of-grammar speech
- **feat:** Context-aware disambiguation — resolves ambiguous tile references ("the browser", "the waiting terminal") via multi-step resolution cascade
- **feat:** Voice dictation and standup notes — continuous speech-to-note with timestamped entries
- **feat:** Ambient visual monitoring — flashes transcript on terminal waiting/error/exit/notification events
- **feat:** Voice workflow triggers — spawn workspace templates by voice ("start code review")
- **feat:** Voice settings UI with activation mode picker, wake word selector, model chooser, device selection, LLM endpoint discovery, and command reference
- **feat:** Agent orchestration workspace — `POST /api/terminal/spawn` lets agents programmatically spawn worker terminal tiles with radial fan layout, purple team edges, auto-type commands, and team role badges
- **feat:** `POST /api/terminal/write` endpoint to send commands to any terminal tile
- **refactor:** Extract canvas state to Zustand store for voice system integration

### 2026-04-13 / 04-14

- **feat:** Persistent browser sessions and Chrome extension side-loading
- **feat:** Drag-to-reorder task items in checklist notes
- **feat:** Comprehensive element editing for draw tile
- **feat:** Allow workspaces to set a default browser URL
- **feat:** macOS DMG packaging and app icon — first downloadable release (v0.1.0)
- **feat:** Clicking a link in a terminal opens a browser tile on the canvas
- **fix:** Prevent terminal scroll jumping to middle on Enter
- **fix:** Prevent shortcuts from firing while typing in note tiles
- **fix:** Hide other-workspace browsers from minimap
- **fix:** Allow backspace to work in note tiles
- **fix:** Read fresh node state in linked-note click handler

## Releasing

The app checks GitHub Releases for updates and downloads new DMGs in-app. To cut a release:

1. Bump `version` in `package.json`.
2. Add the new entry at the top of the Changelog section above.
3. Commit, tag, push:
   ```bash
   git commit -am "chore: release vX.Y.Z"
   git tag vX.Y.Z
   git push --follow-tags
   ```
4. Build and publish artifacts to GitHub Releases (creates a draft):
   ```bash
   GH_TOKEN=<your_personal_access_token> npm run release
   ```
   The token needs `repo` scope. electron-builder uploads `*.dmg`, `*.zip`, `*.blockmap`, and `latest-mac.yml` for both `arm64` and `x64`.
5. Open the draft release on GitHub, paste the changelog into the body, and click **Publish**. The release body becomes the changelog the in-app updater displays — keep it markdown.

Once the release is published, running app instances will detect it on their next check (on launch or every 4 hours) and surface an "Update available" banner.

## License

MIT

# AgentCanvas

An infinite canvas Electron app for spawning terminal and browser tiles side by side. Built for running multiple Claude Code instances (or any terminal-based agents) with full browser control via Chrome DevTools Protocol.

<!-- Add a hero screenshot of the full canvas with terminals and browsers open -->
![AgentCanvas Screenshot](docs/screenshots/canvas-overview.png)

## Features

### Terminal Tiles
Real PTY sessions powered by node-pty with GPU-accelerated rendering via xterm.js WebGL. Each terminal tracks its status (idle/running/waiting), current working directory, and foreground process. Terminals persist across app restarts — positions, metadata, and scrollback are saved on quit and replayed on launch so you pick up right where you left off.

<!-- Screenshot: a few terminal tiles on the canvas -->
![Terminal Tiles](docs/screenshots/terminal-tiles.png)

### Browser Tiles
Embedded browser tiles live on the canvas alongside terminals. Navigate, go back/forward, reload, and resize — all inline. Device preset emulation is built in (iPhone 15, iPad, Pixel 8, Desktop HD, etc.). Browser tiles stay mounted across workspace switches so agent CDP connections aren't interrupted.

<!-- Screenshot: browser tile with device preset selector -->
![Browser Tiles](docs/screenshots/browser-tiles.png)

### Notes Tiles
Rich text notes powered by TipTap with markdown, headings, lists, task lists, blockquotes, and code blocks. Notes link to terminals or other notes via canvas edges and persist to disk automatically with 500ms debounced saves. Soft-close hides a note without deleting it; hard-delete removes it permanently.

### Workspaces
Organize tiles into project-scoped workspaces. Each workspace maintains its own set of terminals, notes, and viewport position. Browser tiles persist across workspace switches with CDP keepalive. Option-hold shows jump hints (1-9, A-Z) to instantly focus any tile in the active workspace.

<!-- Screenshot: workspace panel -->
![Workspaces](docs/screenshots/workspaces.png)

### Process Panel
A sidebar listing all active tiles with real-time status indicators and quick controls — focus, kill, or spawn new tiles. Terminals group hierarchically: parent terminals with child terminals, linked browsers, and linked notes nested underneath. Supports spawning from preset sizes and workspace templates.

<!-- Screenshot: process panel sidebar -->
![Process Panel](docs/screenshots/process-panel.png)

### Settings
Fully configurable via a built-in settings page (Mod+,):

- **General** — Shell, default working directory
- **Appearance** — Terminal font family/size/line height, cursor style and blink
- **Terminal** — Scrollback buffer size, custom environment variables
- **Browser** — Default URL, default device preset
- **Canvas** — Tile gap, zoom range, background dot styling, pan speed, minimap position
- **Hotkeys** — Rebind every action with a visual key recorder
- **Templates** — Save and load tile layouts (3 built-in: Frontend Dev, Research, Multi-terminal)

All settings live-apply — changes reflect immediately in open terminals and UI without restart.

### Canvas API
A local HTTP API server lets agents in terminals programmatically spawn and control browser tiles, set terminal metadata, and query canvas state. Every terminal gets the API endpoint injected as `AGENT_CANVAS_API`.

### CDP Proxy
A two-phase Chrome DevTools Protocol proxy gives agents full browser automation. The port is pre-allocated and injected as `AGENT_BROWSER_CDP_PORT` before the browser even loads, eliminating race conditions between browser spawn and agent connection. Commands queue during attach and flush once the debugger connects.

### Terminal Metadata API
A generic key-value store on each terminal session, settable via `POST /api/terminal/metadata`. Used for worktree integration (branch name, path, URL, database), parent-child grouping, and auto-discovery by browser automation skills. Metadata persists across restarts alongside the terminal tile.

## Keyboard Shortcuts

All shortcuts are rebindable in Settings > Hotkeys.

| Shortcut | Action |
|---|---|
| `Mod+T` | New terminal |
| `Mod+B` | New browser |
| `Mod+N` | New note |
| `Mod+D` | Kill focused tile (hold Cmd for red pulse preview) |
| `Mod+\` | Toggle Process Panel |
| `Mod+Shift+\` | Toggle Workspace Panel |
| `Mod+M` | Toggle Minimap |
| `Mod+,` | Open Settings |
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

## Architecture

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # App lifecycle, IPC handlers, PTY batching
│   ├── terminal-manager.ts  # PTY session management, status polling
│   ├── browser-manager.ts   # Browser session registry
│   ├── cdp-proxy.ts         # Two-phase CDP proxy with command queuing
│   ├── canvas-api.ts        # Local HTTP API server
│   ├── terminal-store.ts    # Terminal tile persistence across restarts
│   ├── workspace-store.ts   # Workspace state persistence
│   ├── note-store.ts        # Note file I/O
│   ├── settings-store.ts    # Settings with deep merge defaults
│   └── perf-monitor.ts      # Runtime performance measurement
├── renderer/                # React UI
│   ├── components/
│   │   ├── Canvas.tsx       # Infinite canvas (React Flow), tile spawning, persistence
│   │   ├── TerminalTile.tsx # xterm.js tile with status badge and metadata display
│   │   ├── BrowserTile.tsx  # Webview with device presets and CDP attachment
│   │   ├── NotesTile.tsx    # TipTap rich text editor
│   │   ├── ProcessPanel.tsx # Hierarchical tile list with grouping
│   │   ├── WorkspacePanel.tsx # Workspace switcher
│   │   ├── SettingsPage.tsx # Settings UI with 7 categories
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
| Workspaces | `~/.config/AgentCanvas/agentcanvas/workspaces.json` | Saved on change. |
| Settings | `~/.config/AgentCanvas/agentcanvas/settings.json` | Saved on change with deep merge defaults. |
| Notes | `~/AgentCanvas/tmp/note-{id}.json` | Auto-saved with 500ms debounce. |

## Tech Stack

- **Electron 35** — Desktop shell
- **React 19** + **TypeScript 5.8** — UI
- **React Flow 12.6** — Infinite canvas
- **xterm.js 5.5** + WebGL addon — GPU-accelerated terminal rendering
- **node-pty 1.1** — Native PTY sessions
- **TipTap 3.22** — Rich text editor for notes
- **Tailwind CSS v4** — Styling
- **electron-vite** — Build tooling
- **ws** — WebSocket server for CDP proxy

## Performance

- GPU rasterization and zero-copy via Electron flags
- WebGL-accelerated terminal rendering (no CPU rasterization during pan)
- Batched PTY output (4ms flush interval, same as Solo)
- Terminal snapshots during canvas pan
- Passive event listeners for smooth scrolling
- Status updates throttled: per-tile immediate, bulk panel at 300ms
- Optional runtime performance monitor with FPS, frame times, and render counts

## License

MIT

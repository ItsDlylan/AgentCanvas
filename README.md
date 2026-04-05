# AgentCanvas

An infinite canvas Electron app for spawning terminal and browser tiles side by side. Built for running multiple Claude Code instances (or any terminal-based agents) with full browser control via Chrome DevTools Protocol.

<!-- Add a hero screenshot of the full canvas with terminals and browsers open -->
![AgentCanvas Screenshot](docs/screenshots/canvas-overview.png)

## Features

### Terminal Tiles
Real PTY sessions powered by node-pty with GPU-accelerated rendering via xterm.js WebGL. Each terminal tracks its status (idle/running/waiting), current working directory, and foreground process. Scrollback is preserved across workspace switches.

<!-- Screenshot: a few terminal tiles on the canvas -->
![Terminal Tiles](docs/screenshots/terminal-tiles.png)

### Browser Tiles
Embedded browser tiles live on the canvas alongside terminals. Navigate, go back/forward, reload, and resize — all inline. Device preset emulation is built in (iPhone 15, iPad, Pixel 8, Desktop HD, etc.).

<!-- Screenshot: browser tile with device preset selector -->
![Browser Tiles](docs/screenshots/browser-tiles.png)

### Workspaces
Organize tiles into project-scoped workspaces. Each workspace maintains its own set of terminals and viewport position. Browser tiles persist across workspace switches with CDP keepalive so agent connections aren't interrupted.

<!-- Screenshot: workspace panel -->
![Workspaces](docs/screenshots/workspaces.png)

### Canvas API
A local HTTP API server lets agents in terminals programmatically spawn and control browser tiles. Every terminal gets the API endpoint injected as `AGENT_CANVAS_API`.

### CDP Proxy
A two-phase Chrome DevTools Protocol proxy gives agents full browser automation. The port is pre-allocated and injected as `AGENT_BROWSER_CDP_PORT` before the browser even loads, eliminating race conditions between browser spawn and agent connection.

### Process Panel
A sidebar listing all active tiles with status indicators and quick controls — focus, kill, or spawn new terminals and browsers.

<!-- Screenshot: process panel sidebar -->
![Process Panel](docs/screenshots/process-panel.png)

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
├── main/                  # Electron main process
│   ├── index.ts           # App lifecycle, IPC handlers, PTY batching
│   ├── terminal-manager.ts
│   ├── browser-manager.ts
│   ├── cdp-proxy.ts       # Two-phase CDP proxy
│   ├── canvas-api.ts      # Local HTTP API server
│   ├── workspace-store.ts
│   └── perf-monitor.ts
├── renderer/              # React UI
│   ├── components/
│   │   ├── Canvas.tsx     # Infinite canvas (React Flow)
│   │   ├── TerminalTile.tsx
│   │   ├── BrowserTile.tsx
│   │   ├── ProcessPanel.tsx
│   │   └── WorkspacePanel.tsx
│   └── hooks/             # useTerminal, useBrowser, etc.
└── preload/               # IPC bridge (context isolation)
    └── index.ts
```

**Main process** manages PTY sessions, browser state, the CDP proxy, and the Canvas API HTTP server. PTY output is batched at 4ms intervals to prevent IPC flooding.

**Renderer** uses [React Flow](https://reactflow.dev/) for the infinite canvas and xterm.js for terminal rendering. Terminals snapshot during pan to avoid cascading re-renders.

**Preload** bridges main ↔ renderer via context-isolated IPC, exposing `window.terminal`, `window.browser`, `window.workspace`, and `window.debug` APIs.

## Canvas API

Agents running inside terminals can control the canvas via the HTTP API at `$AGENT_CANVAS_API`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/browser/open` | POST | Spawn a browser tile |
| `/api/browser/navigate` | POST | Navigate an existing browser |
| `/api/browser/resize` | POST | Resize a browser tile |
| `/api/browser/close` | POST | Close a browser tile |
| `/api/status` | GET | List all terminals and browsers |

### Example: Spawn a browser from a terminal agent

```bash
curl -s -X POST $AGENT_CANVAS_API/api/browser/open \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}'
```

## Environment Variables

Every terminal spawned on the canvas gets these injected automatically:

| Variable | Description |
|---|---|
| `AGENT_CANVAS_API` | Local HTTP API endpoint for canvas control |
| `AGENT_BROWSER_CDP_PORT` | Pre-allocated CDP port for browser automation |
| `AGENT_CANVAS_TERMINAL_ID` | Unique ID for the terminal session |

## Tech Stack

- **Electron** — Desktop shell
- **React 19** + **TypeScript** — UI
- **React Flow** — Infinite canvas
- **xterm.js** + WebGL addon — Terminal rendering
- **node-pty** — Native PTY sessions
- **Tailwind CSS v4** — Styling
- **electron-vite** — Build tooling
- **ws** — WebSocket server for CDP proxy

## Performance

- GPU rasterization via Electron flags
- WebGL-accelerated terminal rendering
- Batched PTY output (4ms flush interval)
- Terminal snapshots during canvas pan
- Passive event listeners for smooth scrolling
- Optional runtime performance monitor (`debug.togglePerf()`)

## License

MIT

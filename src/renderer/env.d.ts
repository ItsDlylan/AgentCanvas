/// <reference types="vite/client" />

import type { TerminalAPI, BrowserAPI, WorkspaceAPI, NoteAPI, SettingsAPI, TerminalTilesAPI, BrowserTilesAPI, DiffAPI, EdgeAPI } from '../preload/index'

declare global {
  interface Window {
    terminal: TerminalAPI
    browser: BrowserAPI
    workspace: WorkspaceAPI
    note: NoteAPI
    settings: SettingsAPI
    terminalTiles: TerminalTilesAPI
    browserTiles: BrowserTilesAPI
    diff: DiffAPI
    edges: EdgeAPI
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          preload?: string
          partition?: string
          allowpopups?: boolean
        },
        HTMLElement
      >
    }
  }
}

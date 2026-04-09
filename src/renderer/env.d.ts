/// <reference types="vite/client" />

import type { TerminalAPI, BrowserAPI, WorkspaceAPI, NoteAPI, DrawAPI, SettingsAPI, IdeAPI, TerminalTilesAPI, BrowserTilesAPI, DiffAPI, EdgeAPI, PomodoroAPI } from '../preload/index'

declare global {
  interface Window {
    terminal: TerminalAPI
    browser: BrowserAPI
    workspace: WorkspaceAPI
    note: NoteAPI
    draw: DrawAPI
    settings: SettingsAPI
    ide: IdeAPI
    terminalTiles: TerminalTilesAPI
    browserTiles: BrowserTilesAPI
    diff: DiffAPI
    edges: EdgeAPI
    pomodoro: PomodoroAPI
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

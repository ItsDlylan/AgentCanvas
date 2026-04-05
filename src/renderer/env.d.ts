/// <reference types="vite/client" />

import type { TerminalAPI, BrowserAPI, WorkspaceAPI, NoteAPI } from '../preload/index'

declare global {
  interface Window {
    terminal: TerminalAPI
    browser: BrowserAPI
    workspace: WorkspaceAPI
    note: NoteAPI
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

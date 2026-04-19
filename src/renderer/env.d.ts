/// <reference types="vite/client" />

import type { TerminalAPI, BrowserAPI, WorkspaceAPI, NoteAPI, AttachmentAPI, DrawAPI, ImageAPI, SettingsAPI, IdeAPI, TerminalTilesAPI, BrowserTilesAPI, DiffAPI, EdgeAPI, PomodoroAPI, NotifyAPI, VoiceAPI, TemplateAPI, ClaudeUsageAPI, PlanAPI } from '../preload/index'

declare global {
  interface Window {
    terminal: TerminalAPI
    browser: BrowserAPI
    workspace: WorkspaceAPI
    note: NoteAPI
    plan: PlanAPI
    attachment: AttachmentAPI
    draw: DrawAPI
    settings: SettingsAPI
    ide: IdeAPI
    terminalTiles: TerminalTilesAPI
    browserTiles: BrowserTilesAPI
    diff: DiffAPI
    edges: EdgeAPI
    pomodoro: PomodoroAPI
    claudeUsage: ClaudeUsageAPI
    notify: NotifyAPI
    voice: VoiceAPI
    templates: TemplateAPI
    image: ImageAPI
    fileUtils: { getPathForFile: (file: File) => string }
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

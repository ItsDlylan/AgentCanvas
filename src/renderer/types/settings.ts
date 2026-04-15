// ── Shared Settings Types ────────────────────────────────
// These types are used by both the renderer and the main process.
// The main process settings-store re-exports from here to stay in sync.

export interface GeneralSettings {
  shell: string
  defaultCwd: string | null
  ideCommand: string | null
}

export interface AppearanceSettings {
  terminalFontFamily: string
  terminalFontSize: number
  terminalLineHeight: number
  cursorStyle: 'bar' | 'block' | 'underline'
  cursorBlink: boolean
}

export interface TerminalSettings {
  scrollback: number
  customEnvVars: Record<string, string>
}

export interface BrowserSettings {
  defaultUrl: string
  defaultDevicePreset: string
}

export type BackgroundMode =
  | 'dots'
  | 'matrix'
  | 'starfield'
  | 'circuit'
  | 'topographic'
  | 'ocean'
  | 'constellation'
  | 'fireflies'
  | 'snow'

export interface CanvasSettings {
  tileGap: number
  defaultZoom: number
  minZoom: number
  maxZoom: number
  backgroundDotGap: number
  backgroundDotSize: number
  backgroundMode: BackgroundMode
  panSpeed: number
  minimapEnabled: boolean
  minimapPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

export interface TemplateTile {
  type: 'terminal' | 'browser' | 'notes'
  relativePosition: { x: number; y: number }
  width: number
  height: number
  devicePreset?: string
  command?: string
  label?: string
  cwd?: string
  metadata?: Record<string, unknown>
  linkedTo?: string
}

export interface WorkspaceTemplate {
  id: string
  name: string
  isBuiltIn: boolean
  tiles: TemplateTile[]
  voiceTrigger?: string
}

export interface VoiceSettings {
  enabled: boolean
  activationMode: 'push-to-talk' | 'wake-word' | 'always'
  sttProvider: 'whisper' | 'vosk' | 'web-speech'
  whisperModel: 'tiny' | 'base' | 'small'
  pushToTalkHotkey: string
  wakeWord: string
  audioFeedback: boolean
  language: string
  inputDeviceId: string | null
  llmEndpoint: string | null
  llmModel: string | null
  ambientMonitoring: {
    onWaiting: boolean
    onError: boolean
    onExit: boolean
    onNotification: boolean
  }
}

export type HotkeyAction =
  | 'toggleProcessPanel'
  | 'toggleWorkspacePanel'
  | 'toggleMinimap'
  | 'newTerminal'
  | 'newBrowser'
  | 'newNote'
  | 'openSettings'
  | 'cycleFocusForward'
  | 'cycleFocusBackward'
  | 'killFocused'
  | 'openInIde'
  | 'togglePomodoro'
  | 'toggleVoice'

export type HotkeySettings = Record<HotkeyAction, string>

export interface NotificationSettings {
  enabled: boolean
  soundEnabled: boolean
  nativeWhenUnfocused: boolean
}

export interface Settings {
  general: GeneralSettings
  appearance: AppearanceSettings
  terminal: TerminalSettings
  browser: BrowserSettings
  canvas: CanvasSettings
  hotkeys: HotkeySettings
  templates: WorkspaceTemplate[]
  notifications: NotificationSettings
  voice: VoiceSettings
}

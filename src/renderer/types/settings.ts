// ── Shared Settings Types ────────────────────────────────
// These types are used by both the renderer and the main process.
// The main process settings-store re-exports from here to stay in sync.

export interface GeneralSettings {
  shell: string
  defaultCwd: string | null
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

export interface CanvasSettings {
  tileGap: number
  defaultZoom: number
  minZoom: number
  maxZoom: number
  backgroundDotGap: number
  backgroundDotSize: number
}

export interface TemplateTile {
  type: 'terminal' | 'browser' | 'notes'
  relativePosition: { x: number; y: number }
  width: number
  height: number
  devicePreset?: string
}

export interface WorkspaceTemplate {
  id: string
  name: string
  isBuiltIn: boolean
  tiles: TemplateTile[]
}

export interface Settings {
  general: GeneralSettings
  appearance: AppearanceSettings
  terminal: TerminalSettings
  browser: BrowserSettings
  canvas: CanvasSettings
  templates: WorkspaceTemplate[]
}

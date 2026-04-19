import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

// ── Types ────────────────────────────────────────────────

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
  type: 'terminal' | 'browser' | 'notes' | 'draw'
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
  | 'newDraw'
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

export interface PromptCacheSettings {
  showTimer: boolean
  ttlSeconds: number              // 300 (5min) or 3600 (1hr)
  warningThresholdSeconds: number
  autoKeepAlive: boolean
  keepAliveMessage: string
  maxAutoKeepAlives: number       // 0 = unlimited
  notifyOnWarning: boolean
  notifyOnExpiry: boolean
  rankByUrgency: boolean
  detectTtlFromLogs: boolean
}

export interface UpdateSettings {
  autoCheckOnLaunch: boolean
  autoCheckPeriodic: boolean
  checkIntervalHours: number
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
  promptCache: PromptCacheSettings
  updates: UpdateSettings
}

// ── Defaults ─────────────────────────────────────────────

export const DEFAULT_SETTINGS: Settings = {
  general: {
    shell: process.env.SHELL || '/bin/zsh',
    defaultCwd: null,
    ideCommand: null
  },
  appearance: {
    terminalFontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    terminalFontSize: 13,
    terminalLineHeight: 1.2,
    cursorStyle: 'bar',
    cursorBlink: false
  },
  terminal: {
    scrollback: 5000,
    customEnvVars: {}
  },
  browser: {
    defaultUrl: 'https://www.google.com',
    defaultDevicePreset: 'Default'
  },
  canvas: {
    tileGap: 40,
    defaultZoom: 0.85,
    minZoom: 0.2,
    maxZoom: 1.5,
    backgroundDotGap: 20,
    backgroundDotSize: 1,
    backgroundMode: 'dots',
    panSpeed: 0.5,
    minimapEnabled: true,
    minimapPosition: 'bottom-right'
  },
  hotkeys: {
    toggleProcessPanel: 'Mod+\\',
    toggleWorkspacePanel: 'Mod+Shift+\\',
    toggleMinimap: 'Mod+M',
    newTerminal: 'Mod+T',
    newBrowser: 'Mod+B',
    newNote: 'Mod+N',
    newDraw: 'Mod+Shift+D',
    openSettings: 'Mod+,',
    cycleFocusForward: 'Ctrl+Tab',
    cycleFocusBackward: 'Ctrl+Shift+Tab',
    killFocused: 'Mod+D',
    openInIde: 'Mod+Shift+O',
    togglePomodoro: 'Mod+P',
    toggleVoice: 'Mod+Shift+V'
  },
  templates: [
    {
      id: 'builtin-frontend-dev',
      name: 'Frontend Dev',
      isBuiltIn: true,
      tiles: [
        { type: 'terminal', relativePosition: { x: 0, y: 0 }, width: 640, height: 400 },
        { type: 'browser', relativePosition: { x: 680, y: 0 }, width: 800, height: 600 }
      ]
    },
    {
      id: 'builtin-research',
      name: 'Research',
      isBuiltIn: true,
      tiles: [
        { type: 'browser', relativePosition: { x: 0, y: 0 }, width: 800, height: 600 },
        { type: 'notes', relativePosition: { x: 840, y: 0 }, width: 400, height: 400 }
      ]
    },
    {
      id: 'builtin-multi-terminal',
      name: 'Multi-terminal',
      isBuiltIn: true,
      tiles: [
        { type: 'terminal', relativePosition: { x: 0, y: 0 }, width: 640, height: 400 },
        { type: 'terminal', relativePosition: { x: 680, y: 0 }, width: 640, height: 400 },
        { type: 'terminal', relativePosition: { x: 1360, y: 0 }, width: 640, height: 400 }
      ]
    }
  ],
  notifications: {
    enabled: true,
    soundEnabled: true,
    nativeWhenUnfocused: true
  },
  voice: {
    enabled: false,
    activationMode: 'push-to-talk',
    sttProvider: 'whisper',
    whisperModel: 'tiny',
    pushToTalkHotkey: 'Mod+Shift+V',
    wakeWord: 'hey_jarvis',
    audioFeedback: true,
    language: 'en',
    inputDeviceId: null,
    llmEndpoint: null,
    llmModel: null,
    ambientMonitoring: {
      onWaiting: true,
      onError: true,
      onExit: false,
      onNotification: false
    }
  },
  promptCache: {
    showTimer: true,
    ttlSeconds: 300,
    warningThresholdSeconds: 60,
    autoKeepAlive: false,
    keepAliveMessage: '.',
    maxAutoKeepAlives: 10,
    notifyOnWarning: true,
    notifyOnExpiry: true,
    rankByUrgency: true,
    detectTtlFromLogs: true
  },
  updates: {
    autoCheckOnLaunch: true,
    autoCheckPeriodic: true,
    checkIntervalHours: 4
  }
}

// ── Deep merge ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(defaults: any, overrides: any): any {
  const result = { ...defaults }
  for (const key of Object.keys(defaults)) {
    if (!(key in overrides)) continue
    const defaultVal = defaults[key]
    const overrideVal = overrides[key]
    if (
      defaultVal &&
      overrideVal &&
      typeof defaultVal === 'object' &&
      typeof overrideVal === 'object' &&
      !Array.isArray(defaultVal) &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(defaultVal, overrideVal)
    } else {
      result[key] = overrideVal
    }
  }
  return result
}

// ── Persistence ──────────────────────────────────────────

function getStorePath(): string {
  const dir = join(app.getPath('userData'), 'agentcanvas')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

export function loadSettings(): Settings {
  const filePath = getStorePath()
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Record<string, unknown>
    return deepMerge(DEFAULT_SETTINGS, data)
  } catch {
    // File doesn't exist or is corrupted — return defaults
    writeFileSync(filePath, JSON.stringify(DEFAULT_SETTINGS, null, 2))
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(data: Settings): void {
  const filePath = getStorePath()
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

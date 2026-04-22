import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { Settings } from '@/types/settings'

// Re-export for convenience
export type { Settings, AppearanceSettings, TerminalSettings, BrowserSettings, CanvasSettings, HotkeyAction, HotkeySettings, WorkspaceTemplate, TemplateTile, PromptCacheSettings } from '@/types/settings'

// ── Fallback defaults (used before async load completes) ─

const FALLBACK: Settings = {
  general: { shell: '/bin/zsh', defaultCwd: null, ideCommand: null },
  appearance: {
    terminalFontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    terminalFontSize: 13,
    terminalLineHeight: 1.2,
    cursorStyle: 'bar',
    cursorBlink: false
  },
  terminal: { scrollback: 5000, customEnvVars: {} },
  browser: { defaultUrl: 'https://www.google.com', defaultDevicePreset: 'Default' },
  canvas: { tileGap: 40, defaultZoom: 0.85, minZoom: 0.2, maxZoom: 1.5, backgroundDotGap: 20, backgroundDotSize: 1, panSpeed: 0.5, minimapEnabled: true, minimapPosition: 'bottom-right' as const },
  hotkeys: {
    toggleProcessPanel: 'Mod+\\',
    toggleWorkspacePanel: 'Mod+Shift+\\',
    toggleMinimap: 'Mod+M',
    newTerminal: 'Mod+T',
    newBrowser: 'Mod+B',
    newNote: 'Mod+N',
    openSettings: 'Mod+,',
    cycleFocusForward: 'Ctrl+Tab',
    cycleFocusBackward: 'Ctrl+Shift+Tab',
    killFocused: 'Mod+D',
    openInIde: 'Mod+Shift+O',
    toggleVoice: 'Mod+Shift+V',
    zoomToFocused: 'Mod+0',
    openTutorials: 'Mod+Shift+/'
  },
  templates: [],
  notifications: { enabled: true, soundEnabled: true, nativeWhenUnfocused: true },
  voice: {
    enabled: false,
    activationMode: 'push-to-talk' as const,
    sttProvider: 'whisper' as const,
    whisperModel: 'tiny' as const,
    pushToTalkHotkey: 'Mod+Shift+V',
    wakeWord: 'hey_jarvis',
    audioFeedback: true,
    language: 'en',
    inputDeviceId: null,
    llmEndpoint: null,
    llmModel: null,
    ambientMonitoring: { onWaiting: true, onError: true, onExit: false, onNotification: false }
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
  },
  flowMute: {
    enabled: true,
    idleTimeoutMs: 300_000,
    entryThresholdMs: 180_000,
    suppressNative: true,
    muteSounds: true,
    showRing: true
  },
  tutorials: {
    seenIds: [],
    seenWelcomeAt: null
  }
}

// ── Deep partial merge ───────────────────────────────────

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const result = { ...base }
  for (const key of Object.keys(patch)) {
    if (!(key in base)) continue
    const baseVal = base[key]
    const patchVal = patch[key]
    if (
      baseVal && patchVal &&
      typeof baseVal === 'object' && typeof patchVal === 'object' &&
      !Array.isArray(baseVal) && !Array.isArray(patchVal)
    ) {
      result[key as keyof T] = deepMerge(
        baseVal as Record<string, unknown>,
        patchVal as Record<string, unknown>
      ) as T[keyof T]
    } else {
      result[key as keyof T] = patchVal as T[keyof T]
    }
  }
  return result
}

// ── Context ──────────────────────────────────────────────

interface SettingsContextValue {
  settings: Settings
  updateSettings: (patch: DeepPartial<Settings>) => void
  resetSettings: () => void
  loaded: boolean
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: FALLBACK,
  updateSettings: () => {},
  resetSettings: () => {},
  loaded: false
})

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext)
}

// ── Provider ─────────────────────────────────────────────

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(FALLBACK)
  const [loaded, setLoaded] = useState(false)

  // Load settings on mount
  useEffect(() => {
    window.settings.load().then((s) => {
      setSettings(s)
      setLoaded(true)
    })
  }, [])

  // Subscribe to changes from main process
  useEffect(() => {
    return window.settings.onChanged((s) => setSettings(s))
  }, [])

  const updateSettings = useCallback(
    (patch: DeepPartial<Settings>) => {
      const merged = deepMerge(settings as unknown as Record<string, unknown>, patch as Record<string, unknown>) as unknown as Settings
      // Handle templates array replacement (not deep-merged)
      if (patch.templates) {
        merged.templates = patch.templates as Settings['templates']
      }
      setSettings(merged)
      window.settings.save(merged)
    },
    [settings]
  )

  const resetSettings = useCallback(() => {
    window.settings.getDefaults().then((defaults) => {
      setSettings(defaults)
      window.settings.save(defaults)
    })
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetSettings, loaded }}>
      {children}
    </SettingsContext.Provider>
  )
}

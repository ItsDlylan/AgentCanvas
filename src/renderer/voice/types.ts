// ── Voice Feature Types ───────────────────────────────────

export type VoiceMode = 'idle' | 'listening' | 'processing' | 'confirming' | 'dictating'

export interface VoiceSettings {
  enabled: boolean
  activationMode: 'push-to-talk' | 'wake-word' | 'always'
  sttProvider: 'whisper' | 'vosk' | 'web-speech'
  whisperModel: 'tiny' | 'base' | 'small'
  pushToTalkHotkey: string
  wakeWord: string
  audioFeedback: boolean
  language: string
  llmEndpoint: string | null
  llmModel: string | null
  ambientMonitoring: {
    onWaiting: boolean
    onError: boolean
    onExit: boolean
    onNotification: boolean
  }
}

export interface VoiceAction {
  type: string
  params: Record<string, unknown>
  destructive: boolean
  targets?: string[]
}

export interface VoiceCommandPattern {
  patterns: RegExp[]
  action: string
  extract?: (match: RegExpMatchArray) => Record<string, unknown>
  destructive?: boolean
}

export interface TileInfo {
  sessionId: string
  type: string
  label: string
  status?: string
  workspaceId: string
  position: { x: number; y: number }
  metadata?: Record<string, unknown>
}

export interface WorkspaceInfo {
  id: string
  name: string
}

export interface VoiceContext {
  focusedTileId: string | null
  focusedTileType: string | null
  focusedTileLabel: string | null
  visibleTiles: TileInfo[]
  allTiles: TileInfo[]
  workspaces: WorkspaceInfo[]
  activeWorkspace: string
  unreadCount: number
}

export interface UndoableAction {
  action: VoiceAction
  undo: () => void
  timestamp: number
}

export interface VoiceTranscript {
  text: string
  confidence?: number
  provider: 'whisper' | 'vosk' | 'web-speech'
  durationMs: number
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  activationMode: 'push-to-talk',
  sttProvider: 'whisper',
  whisperModel: 'tiny',
  pushToTalkHotkey: 'Mod+Shift+V',
  wakeWord: 'canvas',
  audioFeedback: true,
  language: 'en',
  llmEndpoint: null,
  llmModel: null,
  ambientMonitoring: {
    onWaiting: true,
    onError: true,
    onExit: false,
    onNotification: false
  }
}

export interface DevicePreset {
  name: string
  width: number
  height: number
  mobile: boolean
  dpr: number
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { name: 'iPhone 15', width: 393, height: 852, mobile: true, dpr: 3 },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932, mobile: true, dpr: 3 },
  { name: 'iPad', width: 820, height: 1180, mobile: true, dpr: 2 },
  { name: 'Pixel 8', width: 412, height: 924, mobile: true, dpr: 2.625 },
  { name: 'Desktop HD', width: 1440, height: 900, mobile: false, dpr: 1 },
  { name: 'Full HD', width: 1920, height: 1080, mobile: false, dpr: 1 },
  { name: 'Responsive', width: 0, height: 0, mobile: false, dpr: 0 }
]

// Browser chrome dimensions shared between BrowserTile and Canvas
export const BROWSER_CHROME_HEIGHT = 33 + 32 + 2 // header ~33px, addressbar ~32px, top+bottom border 2px
export const BROWSER_CHROME_WIDTH = 2 // left + right border

// Presets available when spawning a browser from the sidebar
export const BROWSER_SPAWN_PRESETS: DevicePreset[] = [
  { name: 'Default', width: 800, height: 600, mobile: false, dpr: 1 },
  ...DEVICE_PRESETS.filter((p) => p.width > 0)
]

export interface TerminalPreset {
  name: string
  width: number
  height: number
}

export const TERMINAL_PRESETS: TerminalPreset[] = [
  { name: 'Default', width: 640, height: 400 },
  { name: 'Small', width: 480, height: 300 },
  { name: 'Medium', width: 800, height: 500 },
  { name: 'Large', width: 1024, height: 640 },
  { name: 'Wide', width: 1200, height: 400 },
  { name: 'Tall', width: 640, height: 800 }
]

export interface AgentPreset {
  id: string
  name: string
  command?: string
  description: string
  dotClass: string
  textClass: string
}

export const AGENT_PRESETS: AgentPreset[] = [
  { id: 'plain',    name: 'Terminal',    command: undefined,  description: 'Plain shell session',       dotClass: 'bg-zinc-400',   textClass: 'text-zinc-300' },
  { id: 'claude',   name: 'Claude Code', command: 'claude',   description: 'Anthropic coding agent',   dotClass: 'bg-orange-500', textClass: 'text-orange-400' },
  { id: 'codex',    name: 'Codex',       command: 'codex',    description: 'OpenAI Codex CLI',         dotClass: 'bg-green-500',  textClass: 'text-green-400' },
  { id: 'gemini',   name: 'Gemini CLI',  command: 'gemini',   description: 'Google Gemini agent',      dotClass: 'bg-blue-500',   textClass: 'text-blue-400' },
  { id: 'opencode', name: 'OpenCode',    command: 'opencode', description: 'Open-source coding agent', dotClass: 'bg-purple-500', textClass: 'text-purple-400' },
]

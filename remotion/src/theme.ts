// Palette mirrors AgentCanvas's renderer palette so the Welcome video
// feels visually continuous with the app when it plays inside the overlay.
export const theme = {
  bg: '#09090b',
  panel: '#18181b',
  panelSoft: '#1a1b22',
  border: '#27272a',
  borderSoft: '#1f1f23',
  text: '#e4e4e7',
  textMuted: '#a1a1aa',
  textDim: '#52525b',
  blue: '#3b82f6',
  blueSoft: 'rgba(59, 130, 246, 0.18)',
  green: '#22c55e',
  orange: '#f59e0b',
  purple: '#8b5cf6',
  pink: '#ec4899'
} as const

export const fontStack =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', 'Segoe UI', sans-serif"
export const monoStack =
  "'SF Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace"

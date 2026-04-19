import { useEffect } from 'react'
import type { HotkeyAction, HotkeySettings } from '@/types/settings'

const isMac = navigator.platform.includes('Mac')

// Map shifted characters back to their unshifted physical key equivalents.
// When Shift is held, event.key reports the shifted character (e.g. | instead of \).
// This lets us match bindings defined with the unshifted key name.
const SHIFTED_KEY_MAP: Record<string, string> = {
  '|': '\\', '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
  '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=',
  '{': '[', '}': ']', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/'
}

// ── Matching ────────────────────────────────────────────

/**
 * Check if a keyboard event matches a binding string like "Mod+Shift+Tab".
 * `Mod` resolves to Meta on macOS and Ctrl elsewhere.
 * Ensures no extra modifiers are pressed beyond what the binding specifies.
 */
export function matchesHotkey(event: KeyboardEvent, binding: string): boolean {
  const parts = binding.split('+')
  const key = parts[parts.length - 1].toLowerCase()
  const modifiers = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()))

  // Resolve expected modifier flags
  const wantCtrl =
    modifiers.has('ctrl') || (!isMac && modifiers.has('mod'))
  const wantMeta =
    modifiers.has('meta') || (isMac && modifiers.has('mod'))
  const wantShift = modifiers.has('shift')
  const wantAlt = modifiers.has('alt')

  // Check key match — also try the unshifted equivalent for shifted punctuation
  const eventKey = event.key.toLowerCase()
  const unshiftedKey = SHIFTED_KEY_MAP[event.key]?.toLowerCase()
  if (eventKey !== key && unshiftedKey !== key) return false

  // Check exact modifier match (no extra modifiers)
  if (event.ctrlKey !== wantCtrl) return false
  if (event.metaKey !== wantMeta) return false
  if (event.shiftKey !== wantShift) return false
  if (event.altKey !== wantAlt) return false

  return true
}

/**
 * Returns true if the event matches ANY registered hotkey binding.
 * Used by useTerminal to suppress xterm handling of global hotkeys.
 */
export function isGlobalHotkey(
  event: KeyboardEvent,
  hotkeys: HotkeySettings | undefined
): boolean {
  const resolved = { ...DEFAULT_HOTKEYS, ...hotkeys }
  for (const binding of Object.values(resolved)) {
    if (matchesHotkey(event, binding)) return true
  }
  return false
}

// ── Display formatting ──────────────────────────────────

const DISPLAY_MAP: Record<string, string> = isMac
  ? { mod: '\u2318', ctrl: '\u2303', shift: '\u21E7', alt: '\u2325', meta: '\u2318', tab: '\u21E5', '\\': '\\' }
  : { mod: 'Ctrl', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Win', tab: 'Tab', '\\': '\\' }

/** Format a binding string for display, using platform symbols. */
export function formatHotkey(binding: string): string {
  return binding
    .split('+')
    .map((part) => DISPLAY_MAP[part.toLowerCase()] ?? part)
    .join(isMac ? '' : '+')
}

// ── Recording ───────────────────────────────────────────

/**
 * Convert a keydown event into a binding string for the recording UI.
 * Returns null for bare modifier presses (user hasn't finished the combo).
 */
export function captureHotkey(event: KeyboardEvent): string | null {
  const key = event.key
  // Ignore bare modifier presses
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(key)) return null

  const parts: string[] = []
  if (event.ctrlKey) parts.push(isMac ? 'Ctrl' : 'Mod')
  if (event.metaKey) parts.push(isMac ? 'Mod' : 'Meta')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  // Normalize key name — map shifted punctuation back to unshifted equivalent
  let normalizedKey = key
  if (event.shiftKey && SHIFTED_KEY_MAP[key]) {
    normalizedKey = SHIFTED_KEY_MAP[key]
  } else if (key === ' ') normalizedKey = 'Space'
  else if (key.length === 1) normalizedKey = key.toUpperCase()
  else normalizedKey = key.charAt(0).toUpperCase() + key.slice(1)

  parts.push(normalizedKey)
  return parts.join('+')
}

// ── Default bindings (for reset in settings UI) ─────────

export const DEFAULT_HOTKEYS: HotkeySettings = {
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
  togglePomodoro: 'Mod+P',
  toggleVoice: 'Mod+Shift+V',
  zoomToFocused: 'Mod+0'
}

// ── Hook ────────────────────────────────────────────────

/**
 * Register a global keydown handler that dispatches hotkey actions.
 * Canvas.tsx builds the actions record from its own state/callbacks.
 */
export function useHotkeys(
  hotkeys: HotkeySettings | undefined,
  actions: Record<HotkeyAction, () => void>
): void {
  useEffect(() => {
    const resolved = { ...DEFAULT_HOTKEYS, ...hotkeys }
    const handler = (event: KeyboardEvent) => {
      // Don't intercept when an input/textarea/select is focused (e.g. settings fields)
      const tag = (event.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((event.target as HTMLElement)?.isContentEditable) return

      for (const [action, binding] of Object.entries(resolved)) {
        if (matchesHotkey(event, binding)) {
          event.preventDefault()
          event.stopPropagation()
          actions[action as HotkeyAction]()
          return
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hotkeys, actions])
}

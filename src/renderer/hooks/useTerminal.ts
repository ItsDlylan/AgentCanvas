import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { isGlobalHotkey } from '@/hooks/useHotkeys'
import type { HotkeySettings } from '@/types/settings'

export interface TerminalAppearance {
  terminalFontFamily: string
  terminalFontSize: number
  terminalLineHeight: number
  cursorStyle: 'bar' | 'block' | 'underline'
  cursorBlink: boolean
  scrollback: number
}

interface UseTerminalOptions {
  sessionId: string
  label: string
  cwd?: string
  appearance?: TerminalAppearance
  hotkeys?: HotkeySettings
  onReady?: () => void
  onExit?: (sessionId: string) => void
}

/**
 * Hook that manages an xterm.js instance connected to a PTY session.
 *
 * Uses WebGL addon (like Collaborator) — GPU-rendered terminals don't
 * trigger CPU re-rasterization during canvas pan transforms.
 *
 * Supports reconnect: when a workspace switch unmounts the component while
 * the PTY keeps running, the next mount replays the scrollback buffer from
 * the main process so no history is lost.
 */
export function useTerminal({ sessionId, label, cwd, appearance, hotkeys, onReady, onExit }: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const mountedRef = useRef(false)

  const fit = useCallback(() => {
    if (!fitAddonRef.current || !containerRef.current) return
    try {
      fitAddonRef.current.fit()
      const term = terminalRef.current
      if (term) {
        window.terminal.resize(sessionId, term.cols, term.rows)
      }
    } catch {
      // Container not visible yet
    }
  }, [sessionId])

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return
    mountedRef.current = true

    let cancelled = false
    let unsubData: (() => void) | null = null
    let unsubExit: (() => void) | null = null

    const term = new Terminal({
      cursorBlink: appearance?.cursorBlink ?? false,
      cursorStyle: appearance?.cursorStyle ?? 'bar',
      fontSize: appearance?.terminalFontSize ?? 13,
      fontFamily: appearance?.terminalFontFamily ?? "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      lineHeight: appearance?.terminalLineHeight ?? 1.2,
      smoothScrollDuration: 0,
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#fafafa',
        selectionBackground: '#3b82f633',
        black: '#09090b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#fafafa',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff'
      },
      allowTransparency: true,
      scrollback: appearance?.scrollback ?? 5000
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)

    // WebGL addon: renders to GPU framebuffer directly.
    // During pan, compositor transforms the GPU texture — no CPU rasterization.
    // Collaborator uses this same approach (@xterm/addon-webgl v0.19.0).
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => webglAddon.dispose())
      term.loadAddon(webglAddon)
    } catch {
      // WebGL unavailable, falls back to canvas renderer
    }

    // Fix mouse coordinate mismatch caused by CSS transform scaling.
    // React Flow's viewport transform scales screen pixels but xterm divides
    // by unscaled CSS-pixel cell dimensions. Correct in capture phase before
    // xterm's bubble-phase handlers read the coordinates.
    const container = containerRef.current
    const fixMouseCoords = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const scaleX = rect.width / container.offsetWidth
      const scaleY = rect.height / container.offsetHeight
      if (Math.abs(scaleX - 1) < 0.005 && Math.abs(scaleY - 1) < 0.005) return
      Object.defineProperty(e, 'clientX', {
        value: rect.left + (e.clientX - rect.left) / scaleX,
        configurable: true
      })
      Object.defineProperty(e, 'clientY', {
        value: rect.top + (e.clientY - rect.top) / scaleY,
        configurable: true
      })
    }
    const mouseFixEvents = ['mousedown', 'mousemove', 'mouseup'] as const
    for (const type of mouseFixEvents) {
      container.addEventListener(type, fixMouseCoords, { capture: true })
    }

    fitAddon.fit()

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // macOS-native key bindings + global hotkey interception
    term.attachCustomKeyEventHandler((event) => {
      // Intercept global hotkeys before xterm processes them.
      // xterm swallows the event so it won't bubble to window — re-dispatch
      // a clone on window so useHotkeys picks it up.
      if (event.type === 'keydown' && hotkeys && isGlobalHotkey(event, hotkeys)) {
        window.dispatchEvent(new KeyboardEvent('keydown', event))
        return false
      }
      if (event.metaKey && event.key === 'Backspace' && event.type === 'keydown') {
        window.terminal.write(sessionId, '\x15')
        return false
      }
      return true
    })

    // Forward user input to PTY
    term.onData((data) => {
      window.terminal.write(sessionId, data)
    })

    // Subscribe to PTY output — queue during replay, write directly when live
    let live = false
    const dataQueue: string[] = []

    unsubData = window.terminal.onData((id, data) => {
      if (id !== sessionId) return
      if (live) {
        term.write(data)
      } else {
        dataQueue.push(data)
      }
    })

    unsubExit = window.terminal.onExit((id) => {
      if (id === sessionId) {
        onExit?.(sessionId)
      }
    })

    // Create or reconnect to PTY session
    ;(async () => {
      const result = await window.terminal.create(sessionId, label, cwd)
      if (cancelled) return

      if (result.isReconnect) {
        // Replay scrollback from main process buffer
        const { scrollback } = await window.terminal.resume(sessionId)
        if (cancelled) return
        // Wait a frame for WebGL renderer to finish initializing dimensions
        await new Promise(resolve => requestAnimationFrame(resolve))
        if (cancelled) return
        if (scrollback) term.write(scrollback)
        // Discard queued data — it's all pre-pause and already in the scrollback
        dataQueue.length = 0
      } else {
        // New terminal — flush any early data that arrived during create
        for (const d of dataQueue) term.write(d)
        dataQueue.length = 0
      }

      if (cancelled) return
      live = true

      window.terminal.resize(sessionId, term.cols, term.rows)
      onReady?.()
    })()

    return () => {
      cancelled = true
      for (const type of mouseFixEvents) {
        container.removeEventListener(type, fixMouseCoords, { capture: true })
      }
      unsubData?.()
      unsubExit?.()
      term.dispose()
      mountedRef.current = false
    }
  }, [sessionId, onReady])

  // Live-apply appearance changes to already-open terminals
  useEffect(() => {
    const term = terminalRef.current
    if (!term || !appearance) return
    let changed = false
    if (term.options.fontSize !== appearance.terminalFontSize) {
      term.options.fontSize = appearance.terminalFontSize
      changed = true
    }
    if (term.options.fontFamily !== appearance.terminalFontFamily) {
      term.options.fontFamily = appearance.terminalFontFamily
      changed = true
    }
    if (term.options.lineHeight !== appearance.terminalLineHeight) {
      term.options.lineHeight = appearance.terminalLineHeight
      changed = true
    }
    if (term.options.cursorBlink !== appearance.cursorBlink) {
      term.options.cursorBlink = appearance.cursorBlink
    }
    if (term.options.cursorStyle !== appearance.cursorStyle) {
      term.options.cursorStyle = appearance.cursorStyle
    }
    if (changed) fit()
  }, [
    appearance?.terminalFontSize,
    appearance?.terminalFontFamily,
    appearance?.terminalLineHeight,
    appearance?.cursorBlink,
    appearance?.cursorStyle,
    fit
  ])

  return { containerRef, fit, terminal: terminalRef }
}

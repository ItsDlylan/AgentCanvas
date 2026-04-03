import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'

interface UseTerminalOptions {
  sessionId: string
  label: string
  onReady?: () => void
  onExit?: (sessionId: string) => void
}

/**
 * Hook that manages an xterm.js instance connected to a PTY session.
 *
 * Uses WebGL addon (like Collaborator) — GPU-rendered terminals don't
 * trigger CPU re-rasterization during canvas pan transforms.
 */
export function useTerminal({ sessionId, label, onReady, onExit }: UseTerminalOptions) {
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

    const term = new Terminal({
      cursorBlink: false,   // Saves 5-13% CPU per terminal (rAF loop)
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      lineHeight: 1.2,
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
      scrollback: 5000
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

    fitAddon.fit()

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // macOS-native key bindings
    term.attachCustomKeyEventHandler((event) => {
      if (event.metaKey && event.key === 'Backspace' && event.type === 'keydown') {
        window.terminal.write(sessionId, '\x15')
        return false
      }
      return true
    })

    window.terminal.create(sessionId, label)

    term.onData((data) => {
      window.terminal.write(sessionId, data)
    })

    const unsubData = window.terminal.onData((id, data) => {
      if (id === sessionId) term.write(data)
    })

    const unsubExit = window.terminal.onExit((id) => {
      if (id === sessionId) {
        onExit?.(sessionId)
      }
    })

    window.terminal.resize(sessionId, term.cols, term.rows)

    onReady?.()

    return () => {
      unsubData()
      unsubExit()
      term.dispose()
      mountedRef.current = false
    }
  }, [sessionId, onReady])

  return { containerRef, fit, terminal: terminalRef }
}

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
 * Mounts xterm into the provided ref, subscribes to PTY output,
 * and forwards user input back to the main process.
 */
export function useTerminal({ sessionId, label, onReady, onExit }: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const mountedRef = useRef(false)

  // Fit terminal to container
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
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      lineHeight: 1.2,
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

    // Try WebGL renderer for performance
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => webglAddon.dispose())
      term.loadAddon(webglAddon)
    } catch {
      // WebGL not available, fallback to canvas renderer
    }

    fitAddon.fit()

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // macOS-native key bindings: Cmd+Backspace → kill line (Ctrl+U)
    term.attachCustomKeyEventHandler((event) => {
      if (event.metaKey && event.key === 'Backspace' && event.type === 'keydown') {
        window.terminal.write(sessionId, '\x15') // Ctrl+U: kill from cursor to start of line
        return false
      }
      return true
    })

    // Create PTY session in main process
    window.terminal.create(sessionId, label)

    // Forward user input to PTY
    term.onData((data) => {
      window.terminal.write(sessionId, data)
    })

    // Subscribe to PTY output
    const unsubData = window.terminal.onData((id, data) => {
      if (id === sessionId) term.write(data)
    })

    const unsubExit = window.terminal.onExit((id) => {
      if (id === sessionId) {
        onExit?.(sessionId)
      }
    })

    // Resize PTY to match terminal dimensions
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

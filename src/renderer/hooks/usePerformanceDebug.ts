import { useState, useEffect, useRef, useCallback } from 'react'

export interface PerfStats {
  fps: number
  frameTimeMs: number
  maxFrameTimeMs: number
  renderCounts: Record<string, number>
  mainProcessLag: { avgLagMs: number; maxLagMs: number; jankCount: number }
  ipcCounts: Record<string, number>
}

// Global render counter — components call registerRender('ComponentName').
// Guarded by perfEnabled so zero cost when debug mode is off.
const renderCounts: Record<string, number> = {}
let perfEnabled = false

export function registerRender(name: string): void {
  if (!perfEnabled) return
  renderCounts[name] = (renderCounts[name] || 0) + 1
}

export function usePerformanceDebug() {
  const [enabled, setEnabled] = useState(false)
  const [stats, setStats] = useState<PerfStats | null>(null)
  const framesRef = useRef<number[]>([])
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const toggle = useCallback(async () => {
    const result = await (window as any).debug.togglePerf()
    perfEnabled = result.enabled
    setEnabled(result.enabled)

    if (!result.enabled) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (pollRef.current) clearInterval(pollRef.current)
      setStats(null)
      Object.keys(renderCounts).forEach((k) => delete renderCounts[k])
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    // FPS tracking via rAF
    lastTimeRef.current = performance.now()
    function onFrame(ts: number) {
      const delta = ts - lastTimeRef.current
      lastTimeRef.current = ts
      framesRef.current.push(delta)
      if (framesRef.current.length > 120) framesRef.current.shift()
      rafRef.current = requestAnimationFrame(onFrame)
    }
    rafRef.current = requestAnimationFrame(onFrame)

    // Poll main process stats every 1s
    pollRef.current = setInterval(async () => {
      const mainStats = await (window as any).debug.getPerfStats()
      const frames = [...framesRef.current]
      const avg =
        frames.length > 0 ? frames.reduce((a, b) => a + b, 0) / frames.length : 16.67
      const max = frames.length > 0 ? Math.max(...frames) : 0

      setStats({
        fps: Math.round(1000 / avg),
        frameTimeMs: Math.round(avg * 10) / 10,
        maxFrameTimeMs: Math.round(max * 10) / 10,
        renderCounts: { ...renderCounts },
        mainProcessLag: mainStats.eventLoop,
        ipcCounts: mainStats.ipcCounts
      })
      // Reset for next interval
      Object.keys(renderCounts).forEach((k) => {
        renderCounts[k] = 0
      })
      framesRef.current = []
    }, 1000)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [enabled])

  // Keyboard shortcut: Ctrl+Shift+P to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggle])

  return { enabled, stats, toggle }
}

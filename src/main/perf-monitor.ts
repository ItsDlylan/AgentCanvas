/**
 * Main process performance monitor.
 *
 * Measures event loop lag (how long setImmediate is delayed) and counts
 * IPC messages by channel. Toggled at runtime via IPC — zero cost when off.
 */

let enabled = false
let lagSamples: number[] = []
const ipcCounts = new Map<string, number>()
let measureInterval: ReturnType<typeof setInterval> | null = null

export function startPerfMonitor(): void {
  if (enabled) return
  enabled = true
  lagSamples = []
  ipcCounts.clear()

  // Measure event loop lag every 100ms
  measureInterval = setInterval(() => {
    const start = performance.now()
    setImmediate(() => {
      const lag = performance.now() - start
      lagSamples.push(lag)
      if (lagSamples.length > 300) lagSamples.shift() // Keep last 30s
    })
  }, 100)
}

export function stopPerfMonitor(): void {
  enabled = false
  if (measureInterval) {
    clearInterval(measureInterval)
    measureInterval = null
  }
}

export function recordIpc(channel: string): void {
  if (!enabled) return
  ipcCounts.set(channel, (ipcCounts.get(channel) || 0) + 1)
}

export function getPerfStats(): object {
  const lags = [...lagSamples]
  const avg = lags.length > 0 ? lags.reduce((a, b) => a + b, 0) / lags.length : 0
  const max = lags.length > 0 ? Math.max(...lags) : 0
  const jank = lags.filter((l) => l > 50).length

  const ipc = Object.fromEntries(ipcCounts)
  ipcCounts.clear()
  lagSamples = []

  return {
    eventLoop: {
      avgLagMs: Math.round(avg * 100) / 100,
      maxLagMs: Math.round(max * 100) / 100,
      jankCount: jank,
      samples: lags.length
    },
    ipcCounts: ipc
  }
}

export function isPerfEnabled(): boolean {
  return enabled
}

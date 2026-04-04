import { memo } from 'react'
import type { PerfStats } from '@/hooks/usePerformanceDebug'

function PerformanceOverlayComponent({ stats }: { stats: PerfStats }) {
  const fpsColor = stats.fps >= 55 ? '#22c55e' : stats.fps >= 30 ? '#eab308' : '#ef4444'

  return (
    <div
      style={{
        position: 'fixed',
        top: 48,
        left: 8,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        border: '1px solid #333',
        borderRadius: 6,
        padding: '8px 12px',
        fontFamily: 'SF Mono, Menlo, monospace',
        fontSize: 11,
        color: '#e4e4e7',
        lineHeight: 1.5,
        pointerEvents: 'none',
        maxWidth: 280
      }}
    >
      <div style={{ color: fpsColor, fontWeight: 'bold', fontSize: 13 }}>
        {stats.fps} FPS ({stats.frameTimeMs}ms avg, {stats.maxFrameTimeMs}ms max)
      </div>

      <div style={{ marginTop: 4, color: '#a1a1aa', fontSize: 10 }}>MAIN PROCESS EVENT LOOP</div>
      <div>
        Lag: {stats.mainProcessLag.avgLagMs}ms avg, {stats.mainProcessLag.maxLagMs}ms max
        {stats.mainProcessLag.jankCount > 0 && (
          <span style={{ color: '#ef4444' }}> ({stats.mainProcessLag.jankCount} janks)</span>
        )}
      </div>

      {Object.keys(stats.ipcCounts).length > 0 && (
        <>
          <div style={{ marginTop: 4, color: '#a1a1aa', fontSize: 10 }}>IPC/s</div>
          {Object.entries(stats.ipcCounts).map(([ch, count]) => (
            <div key={ch}>
              {ch}: {count}
            </div>
          ))}
        </>
      )}

      {Object.keys(stats.renderCounts).length > 0 && (
        <>
          <div style={{ marginTop: 4, color: '#a1a1aa', fontSize: 10 }}>RENDERS/s</div>
          {Object.entries(stats.renderCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => (
              <div key={name} style={{ color: count > 10 ? '#ef4444' : '#e4e4e7' }}>
                {name}: {count}
              </div>
            ))}
        </>
      )}
    </div>
  )
}

export const PerformanceOverlay = memo(PerformanceOverlayComponent)

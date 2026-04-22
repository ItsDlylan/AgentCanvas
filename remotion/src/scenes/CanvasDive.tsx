import { AbsoluteFill, interpolate, useVideoConfig } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { easeInOut, easeOutExpo, seeded } from '../math'
import { MatrixRain } from './MatrixRain'

interface CanvasDiveProps {
  localFrame: number
  durationInFrames: number
}

/**
 * The centerpiece. The viewer is "zoomed in" on a single tile sketching
 * itself, then the camera pulls out to reveal a whole live canvas of
 * tiles — terminal typing, browser loading, note writing, task checking
 * — all simultaneously. A synthetic "pan" across the canvas keeps the
 * camera alive.
 *
 * We simulate the AgentCanvas UI entirely in SVG/CSS — no recordings.
 */
export const CanvasDive: React.FC<CanvasDiveProps> = ({ localFrame, durationInFrames }) => {
  const { fps } = useVideoConfig()
  const W = 1280
  const H = 720

  // ── Camera: starts zoomed into terminal tile (~4x), pulls out to ~0.7x ──
  // Phase 1 (0 → 35): dramatic zoom-out with slight x drift
  // Phase 2 (35 → end - 20): slow cinematic pan
  // Phase 3 (end - 20 → end): gentle fall-forward into outro
  const zoom = interpolate(
    localFrame,
    [0, 35, durationInFrames - 20, durationInFrames],
    [3.2, 1.0, 0.92, 1.3],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: easeInOut
    }
  )
  const camX = interpolate(
    localFrame,
    [0, 35, durationInFrames],
    [-180, 0, 60],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
  const camY = interpolate(
    localFrame,
    [0, 35, durationInFrames],
    [120, 0, -20],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  // Motion blur on fast zoom
  const fastness = Math.max(0, 1 - Math.abs(localFrame - 16) / 16)
  const motionBlur = fastness * 5

  // Matrix rain fades in as the camera reaches wide-view (replaces dot grid)
  const matrixReveal = interpolate(localFrame, [22, 55], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })

  // Scene fade in/out
  const sceneAlpha = interpolate(
    localFrame,
    [0, 6, durationInFrames - 12, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  return (
    <AbsoluteFill style={{ background: theme.bg, opacity: sceneAlpha }}>
      {/* Matrix rain backdrop — screen-space, sits behind the camera-
          transformed world so it reads as environment, not world content. */}
      <MatrixRain
        width={1280}
        height={720}
        localFrame={localFrame}
        fps={fps}
        opacity={matrixReveal * 0.9}
      />

      {/* Camera container — we build the world at 2560x1440 and scale/pan it. */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 2560,
          height: 1440,
          transform: `translate(-50%, -50%) translate(${camX}px, ${camY}px) scale(${zoom})`,
          transformOrigin: 'center center',
          filter: `blur(${motionBlur}px)`
        }}
      >

        {/* Tiles — positioned relative to the 2560×1440 world */}
        <Tile
          kind="terminal"
          x={1100}
          y={560}
          w={520}
          h={320}
          appearAt={0}
          localFrame={localFrame}
          fps={fps}
        />
        <Tile
          kind="browser"
          x={1680}
          y={420}
          w={640}
          h={420}
          appearAt={38}
          localFrame={localFrame}
          fps={fps}
        />
        <Tile
          kind="note"
          x={340}
          y={300}
          w={420}
          h={280}
          appearAt={52}
          localFrame={localFrame}
          fps={fps}
        />
        <Tile
          kind="task"
          x={540}
          y={880}
          w={380}
          h={260}
          appearAt={66}
          localFrame={localFrame}
          fps={fps}
        />

        {/* Connection edges between tiles — drawn with stroke-dashoffset */}
        <Edges localFrame={localFrame} />

        {/* Floating energy particles travelling along edges */}
        <EdgeParticles localFrame={localFrame} />
      </div>

      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at center, transparent 40%, rgba(9,9,11,0.75) 100%)',
          pointerEvents: 'none'
        }}
      />

      {/* Caption (appears briefly mid-scene) */}
      <Caption localFrame={localFrame} durationInFrames={durationInFrames} />
    </AbsoluteFill>
  )
}

// ── Connection edges between tiles ──
const Edges: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const edgeReveal = interpolate(localFrame, [78, 108], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const dashLen = 600
  const dashOffset = (1 - easeOutExpo(edgeReveal)) * dashLen

  const edges = [
    // terminal → browser
    { x1: 1620, y1: 720, x2: 1680, y2: 630 },
    // note → terminal
    { x1: 760, y1: 440, x2: 1100, y2: 620 },
    // terminal → task
    { x1: 1200, y1: 880, x2: 920, y2: 1010 }
  ]

  return (
    <svg
      width={2560}
      height={1440}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <defs>
        <filter id="edgeGlow">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      {edges.map((e, i) => (
        <path
          key={i}
          d={`M ${e.x1} ${e.y1} C ${(e.x1 + e.x2) / 2} ${e.y1}, ${(e.x1 + e.x2) / 2} ${e.y2}, ${e.x2} ${e.y2}`}
          stroke={theme.blue}
          strokeOpacity={0.55}
          strokeWidth={2.5}
          fill="none"
          strokeDasharray={dashLen}
          strokeDashoffset={dashOffset}
          filter="url(#edgeGlow)"
        />
      ))}
    </svg>
  )
}

// ── Tiny particles travelling along edges (after edges draw) ──
const EdgeParticles: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  if (localFrame < 110) return null
  const t = ((localFrame - 110) / 40) % 1
  const paths = [
    { x1: 1620, y1: 720, x2: 1680, y2: 630 },
    { x1: 760, y1: 440, x2: 1100, y2: 620 },
    { x1: 1200, y1: 880, x2: 920, y2: 1010 }
  ]
  return (
    <svg
      width={2560}
      height={1440}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {paths.map((p, i) => {
        const tt = (t + i * 0.33) % 1
        const x = p.x1 + (p.x2 - p.x1) * tt
        const y = p.y1 + (p.y2 - p.y1) * tt
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={5}
            fill="#fff"
            opacity={0.8 * (1 - Math.abs(tt - 0.5) * 1.4)}
          />
        )
      })}
    </svg>
  )
}

// ── Mid-scene caption ──
const Caption: React.FC<{ localFrame: number; durationInFrames: number }> = ({
  localFrame,
  durationInFrames
}) => {
  const inAt = Math.floor(durationInFrames * 0.45)
  const outAt = Math.floor(durationInFrames * 0.85)
  const alpha = interpolate(
    localFrame,
    [inAt, inAt + 10, outAt, outAt + 12],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
  if (alpha <= 0) return null
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontFamily: fontStack,
        color: theme.text,
        opacity: alpha,
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontFamily: monoStack,
          color: theme.textDim,
          letterSpacing: 3,
          textTransform: 'uppercase',
          marginBottom: 6
        }}
      >
        live on one canvas
      </div>
      <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>
        Terminals · Browsers · Notes · Tasks
      </div>
    </div>
  )
}

// ── The Tile ── tile type → internal mini-scene ──
interface TileProps {
  kind: 'terminal' | 'browser' | 'note' | 'task'
  x: number
  y: number
  w: number
  h: number
  appearAt: number
  localFrame: number
  fps: number
}

const Tile: React.FC<TileProps> = ({ kind, x, y, w, h, appearAt, localFrame }) => {
  const frame = localFrame - appearAt
  if (frame < -5) return null

  // Stroke-draw the border
  const borderPerimeter = 2 * (w + h)
  const borderReveal = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const borderOffset = borderPerimeter * (1 - easeOutExpo(borderReveal))

  // Fill fades in after border draws
  const fillAlpha = interpolate(frame, [10, 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })

  const accent = {
    terminal: theme.green,
    browser: theme.blue,
    note: theme.orange,
    task: theme.purple
  }[kind]

  // Wake-up glow pulse when the tile becomes "live" (frame 18 → 30)
  const wakePulse = interpolate(frame, [18, 28, 40], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        fontFamily: fontStack
      }}
    >
      {/* Outer glow (during wake-up) */}
      <div
        style={{
          position: 'absolute',
          inset: -4,
          borderRadius: 16,
          boxShadow: `0 0 60px ${accent}`,
          opacity: wakePulse * 0.7,
          pointerEvents: 'none'
        }}
      />

      {/* Border stroke animation */}
      <svg
        width={w}
        height={h}
        style={{ position: 'absolute', inset: 0 }}
      >
        <rect
          x={1}
          y={1}
          width={w - 2}
          height={h - 2}
          rx={14}
          stroke={accent}
          strokeOpacity={0.9}
          strokeWidth={2}
          fill="none"
          strokeDasharray={borderPerimeter}
          strokeDashoffset={borderOffset}
        />
      </svg>

      {/* Filled panel */}
      <div
        style={{
          position: 'absolute',
          inset: 2,
          borderRadius: 13,
          background: `linear-gradient(160deg, #16171c 0%, #0e0f13 100%)`,
          opacity: fillAlpha,
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 16px',
            borderBottom: `1px solid ${theme.border}`
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 999, background: accent }} />
          <span
            style={{
              fontSize: 13,
              color: theme.textMuted,
              fontFamily: monoStack
            }}
          >
            {kind}
          </span>
        </div>

        {/* Body — per-kind */}
        <div style={{ padding: 14 }}>
          {kind === 'terminal' && <TerminalBody frame={frame} accent={accent} />}
          {kind === 'browser' && <BrowserBody frame={frame} accent={accent} />}
          {kind === 'note' && <NoteBody frame={frame} accent={accent} />}
          {kind === 'task' && <TaskBody frame={frame} accent={accent} />}
        </div>
      </div>
    </div>
  )
}

// ── Tile bodies ──

const TerminalBody: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  const lines = [
    { at: 20, text: '$ claude' },
    { at: 34, text: '● spawning team…' },
    { at: 48, text: '  ├ reviewer' },
    { at: 56, text: '  ├ tester' },
    { at: 64, text: '  └ writer' },
    { at: 78, text: '✓ team ready' }
  ]
  const cursorVisible = Math.floor(frame / 8) % 2 === 0
  return (
    <div style={{ fontFamily: monoStack, fontSize: 16, lineHeight: 1.5 }}>
      {lines.map((l, i) => {
        if (frame < l.at) return null
        const chars = l.text.length
        const revealed = Math.min(chars, Math.floor((frame - l.at) * 1.6))
        const done = revealed >= chars
        const color = l.text.startsWith('✓')
          ? accent
          : l.text.startsWith('●')
          ? '#fbbf24'
          : l.text.startsWith('$')
          ? '#fff'
          : theme.textMuted
        return (
          <div key={i} style={{ color }}>
            {l.text.slice(0, revealed)}
            {!done && cursorVisible ? '▎' : ''}
          </div>
        )
      })}
    </div>
  )
}

const BrowserBody: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  const urlChars = 'claude.ai/agentcanvas'.length
  const typed = Math.min(urlChars, Math.floor(frame * 0.8))
  const loadProgress = Math.min(1, Math.max(0, (frame - 24) / 30))
  const contentReveal = Math.min(1, Math.max(0, (frame - 44) / 20))
  return (
    <div>
      {/* URL bar */}
      <div
        style={{
          padding: '6px 10px',
          background: '#0b0c10',
          border: `1px solid ${theme.border}`,
          borderRadius: 7,
          fontFamily: monoStack,
          fontSize: 13,
          color: theme.textMuted,
          marginBottom: 12
        }}
      >
        {'claude.ai/agentcanvas'.slice(0, typed)}
        <span style={{ color: theme.textDim }}>
          {typed < urlChars ? '▏' : ''}
        </span>
      </div>
      {/* Load bar */}
      <div
        style={{
          height: 2,
          background: theme.border,
          borderRadius: 1,
          overflow: 'hidden',
          marginBottom: 16
        }}
      >
        <div
          style={{
            width: `${loadProgress * 100}%`,
            height: '100%',
            background: accent,
            boxShadow: `0 0 8px ${accent}`
          }}
        />
      </div>
      {/* Content skeleton */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: contentReveal }}>
        <div style={{ height: 12, width: '70%', background: '#202128', borderRadius: 4 }} />
        <div style={{ height: 56, width: '100%', background: '#1b1c22', borderRadius: 8 }} />
        <div style={{ height: 10, width: '90%', background: '#1a1b21', borderRadius: 4 }} />
        <div style={{ height: 10, width: '60%', background: '#1a1b21', borderRadius: 4 }} />
      </div>
    </div>
  )
}

const NoteBody: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  const title = '# Tutorials plan'
  const lines = [
    { at: 15, text: '- Ship welcome vid' },
    { at: 30, text: '- Record terminals' },
    { at: 45, text: '- Record browser' }
  ]
  const titleReveal = Math.min(title.length, Math.floor(frame * 1.2))
  return (
    <div style={{ fontFamily: monoStack, fontSize: 15, lineHeight: 1.5 }}>
      <div style={{ color: accent, marginBottom: 6 }}>{title.slice(0, titleReveal)}</div>
      {lines.map((l, i) => {
        if (frame < l.at) return null
        const r = Math.min(l.text.length, Math.floor((frame - l.at) * 1.4))
        return (
          <div key={i} style={{ color: theme.textMuted }}>
            {l.text.slice(0, r)}
          </div>
        )
      })}
    </div>
  )
}

const TaskBody: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  const tasks = [
    { label: 'Classify intent', checkAt: 22 },
    { label: 'Link to plan', checkAt: 38 },
    { label: 'Mark reviewed', checkAt: 54 }
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {tasks.map((t, i) => {
        const checked = frame >= t.checkAt
        const scale = checked
          ? 1 + 0.3 * Math.max(0, 1 - (frame - t.checkAt) / 8)
          : 1
        return (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16 }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                border: `2px solid ${checked ? accent : theme.border}`,
                background: checked ? accent : 'transparent',
                transform: `scale(${scale})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 13,
                lineHeight: 1
              }}
            >
              {checked ? '✓' : ''}
            </div>
            <span
              style={{
                color: checked ? theme.textDim : theme.text,
                textDecoration: checked ? 'line-through' : 'none'
              }}
            >
              {t.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

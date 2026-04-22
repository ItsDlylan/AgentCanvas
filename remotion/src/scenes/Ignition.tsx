import { AbsoluteFill, interpolate, spring, useVideoConfig } from 'remotion'
import { theme } from '../theme'
import { easeOutExpo, seeded } from '../math'

interface IgnitionProps {
  localFrame: number
  durationInFrames: number
}

/**
 * Cold open: 120 particles streak in from the edges, collide at center,
 * explode into an expanding light ring, from which the "?" mark strokes
 * itself into existence.
 */
export const Ignition: React.FC<IgnitionProps> = ({ localFrame, durationInFrames }) => {
  const { fps } = useVideoConfig()
  const width = 1280
  const height = 720
  const cx = width / 2
  const cy = height / 2

  // Particles converge from frame 0 → 28
  const converge = interpolate(localFrame, [0, 28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const convergeEased = easeOutExpo(converge)

  // Core flash at ~frame 28
  const flashAlpha = interpolate(localFrame, [26, 32, 42], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })

  // Shockwave ring expands 28 → 55
  const ringProgress = interpolate(localFrame, [28, 55], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const ringRadius = ringProgress * 520
  const ringAlpha = 1 - ringProgress

  // "?" mark stroke draws 34 → 50, then fills 50 → 58
  const strokeLen = 340
  const strokeReveal = interpolate(localFrame, [34, 50], [strokeLen, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const fillOpacity = interpolate(localFrame, [50, 60], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })

  // Mark pulse scale
  const markScale = spring({
    frame: Math.max(0, localFrame - 30),
    fps,
    config: { damping: 10, stiffness: 120, mass: 0.5 }
  })

  // Scene exit compresses the mark
  const exit = interpolate(
    localFrame,
    [durationInFrames - 12, durationInFrames],
    [1, 0.6],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
  const exitAlpha = interpolate(
    localFrame,
    [durationInFrames - 10, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  const particles = Array.from({ length: 140 }, (_, i) => {
    const angle = seeded(i + 1) * Math.PI * 2
    const distance = 520 + seeded(i + 7) * 260
    const delay = seeded(i + 13) * 0.35
    const pt = Math.max(0, (converge - delay) / (1 - delay))
    const pte = easeOutExpo(pt)
    const x = cx + Math.cos(angle) * distance * (1 - pte)
    const y = cy + Math.sin(angle) * distance * (1 - pte)
    const trail = (1 - pte) * 60
    const tx = cx + Math.cos(angle) * (distance * (1 - pte) + trail)
    const ty = cy + Math.sin(angle) * (distance * (1 - pte) + trail)
    const opacity = pte < 1 ? 0.55 + 0.45 * pte : 0
    const hueMix = seeded(i + 29)
    const color = hueMix < 0.5 ? theme.blue : hueMix < 0.8 ? '#a855f7' : theme.pink
    return { x, y, tx, ty, opacity, color, i }
  })

  return (
    <AbsoluteFill style={{ background: theme.bg, opacity: exitAlpha }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <radialGradient id="coreFlash" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
            <stop offset="30%" stopColor={theme.blue} stopOpacity={0.8} />
            <stop offset="100%" stopColor={theme.blue} stopOpacity={0} />
          </radialGradient>
          <linearGradient id="markGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Particle streaks */}
        {convergeEased < 1 &&
          particles.map((p) => (
            <line
              key={p.i}
              x1={p.x}
              y1={p.y}
              x2={p.tx}
              y2={p.ty}
              stroke={p.color}
              strokeWidth={1.4}
              strokeLinecap="round"
              opacity={p.opacity}
            />
          ))}

        {/* Core flash */}
        {flashAlpha > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={280}
            fill="url(#coreFlash)"
            opacity={flashAlpha}
          />
        )}

        {/* Shockwave ring */}
        {ringAlpha > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={ringRadius}
            stroke={theme.blue}
            strokeWidth={3}
            fill="none"
            opacity={ringAlpha * 0.8}
            filter="url(#glow)"
          />
        )}

        {/* "?" mark */}
        {markScale > 0 && (
          <g
            transform={`translate(${cx} ${cy}) scale(${markScale * exit})`}
            style={{ transformBox: 'fill-box' }}
          >
            {/* Soft halo */}
            <circle cx={0} cy={0} r={85} fill={theme.blue} opacity={0.12} filter="url(#glow)" />
            {/* Stroke draw */}
            <path
              d="M -22 -30 A 28 28 0 1 1 0 8 L 0 28"
              stroke="url(#markGrad)"
              strokeWidth={10}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={strokeLen}
              strokeDashoffset={strokeReveal}
              filter="url(#glow)"
            />
            {/* Dot */}
            <circle
              cx={0}
              cy={52}
              r={7}
              fill="url(#markGrad)"
              opacity={fillOpacity}
              filter="url(#glow)"
            />
          </g>
        )}
      </svg>
    </AbsoluteFill>
  )
}

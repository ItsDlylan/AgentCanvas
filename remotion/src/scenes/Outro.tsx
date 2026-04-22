import { AbsoluteFill, interpolate, spring, useVideoConfig } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { easeOutExpo, seeded } from '../math'

interface OutroProps {
  localFrame: number
  durationInFrames: number
}

/**
 * Zoom-out constellation. The canvas we saw becomes a field of stars;
 * a central "?" keycap pulses with a concentric pulse ring; kinetic
 * typography assembles "Press ⌘⇧? anytime" from exploded positions.
 */
export const Outro: React.FC<OutroProps> = ({ localFrame, durationInFrames }) => {
  const { fps } = useVideoConfig()
  const W = 1280
  const H = 720

  // Overall scene fade
  const sceneAlpha = interpolate(
    localFrame,
    [0, 8, durationInFrames - 14, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  // Constellation stars — slow drift
  const stars = Array.from({ length: 140 }, (_, i) => {
    const baseX = seeded(i + 1) * W
    const baseY = seeded(i + 9) * H
    const driftX = Math.sin((localFrame + i * 5) / 60) * 6
    const driftY = Math.cos((localFrame + i * 7) / 80) * 4
    const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((localFrame + i * 11) / 12))
    return {
      i,
      x: baseX + driftX,
      y: baseY + driftY,
      r: 0.8 + seeded(i + 17) * 1.4,
      a: twinkle * (0.3 + 0.7 * seeded(i + 23))
    }
  })

  // Connecting lines between a few nearby stars — hints at "canvas"
  const constellations: { a: number; b: number }[] = [
    { a: 3, b: 18 },
    { a: 22, b: 47 },
    { a: 51, b: 64 },
    { a: 71, b: 88 },
    { a: 91, b: 110 }
  ]

  // Central keycap spring in
  const capSpring = spring({
    frame: Math.max(0, localFrame - 4),
    fps,
    config: { damping: 11, stiffness: 130 }
  })

  // Keycap breathing scale
  const breathing = 1 + Math.sin(localFrame / 8) * 0.015

  // Pulse ring that emits from the cap (every ~45 frames)
  const pulseT = ((localFrame - 20) % 45) / 45
  const pulseRadius = 60 + easeOutExpo(pulseT) * 240
  const pulseAlpha = localFrame < 20 ? 0 : 1 - pulseT

  // Kinetic typography — "Press  ⌘ ⇧ ?  anytime"
  const tokens = [
    { t: 'Press', kind: 'word' },
    { t: '⌘', kind: 'key' },
    { t: '⇧', kind: 'key' },
    { t: '?', kind: 'key' },
    { t: 'anytime', kind: 'word' }
  ] as const

  return (
    <AbsoluteFill style={{ background: theme.bg, opacity: sceneAlpha, overflow: 'hidden' }}>
      {/* Stars + constellation lines */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {constellations.map(({ a, b }, i) => {
          const sa = stars[a % stars.length]
          const sb = stars[b % stars.length]
          if (!sa || !sb) return null
          const alpha = interpolate(localFrame, [20, 45], [0, 0.18], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
          })
          return (
            <line
              key={i}
              x1={sa.x}
              y1={sa.y}
              x2={sb.x}
              y2={sb.y}
              stroke={theme.blue}
              strokeWidth={1}
              opacity={alpha}
            />
          )
        })}
        {stars.map((s) => (
          <circle key={s.i} cx={s.x} cy={s.y} r={s.r} fill="#ffffff" opacity={s.a} />
        ))}
      </svg>

      {/* Central pulse ring */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%)`
        }}
      >
        <div
          style={{
            width: pulseRadius * 2,
            height: pulseRadius * 2,
            borderRadius: 999,
            border: `2px solid ${theme.blue}`,
            opacity: pulseAlpha * 0.55,
            boxShadow: `0 0 30px ${theme.blue}`
          }}
        />
      </div>

      {/* Central keycap */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 140,
          height: 140,
          transform: `translate(-50%, -50%) scale(${capSpring * breathing})`,
          borderRadius: 28,
          background: `linear-gradient(135deg, ${theme.blue} 0%, #6366f1 100%)`,
          boxShadow: '0 30px 80px rgba(59,130,246,0.55), inset 0 -6px 0 rgba(0,0,0,0.3), inset 0 2px 0 rgba(255,255,255,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontFamily: fontStack,
          fontSize: 90,
          fontWeight: 700,
          lineHeight: 1
        }}
      >
        ?
      </div>

      {/* Kinetic typography row below keycap */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, 140px)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontFamily: fontStack,
          color: theme.text
        }}
      >
        {tokens.map((tok, i) => {
          const startFrame = 24 + i * 4
          const s = spring({
            frame: Math.max(0, localFrame - startFrame),
            fps,
            config: { damping: 14, stiffness: 150, mass: 0.5 }
          })
          const angle = (seeded(i + 7) - 0.5) * 60
          const radius = 300
          const fromX = Math.cos((angle * Math.PI) / 180) * radius
          const fromY = Math.sin((angle * Math.PI) / 180) * radius
          const translateX = (1 - s) * fromX
          const translateY = (1 - s) * fromY
          const rotate = (1 - s) * (seeded(i + 11) - 0.5) * 90

          if (tok.kind === 'key') {
            return (
              <span
                key={i}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 52,
                  height: 52,
                  padding: '0 10px',
                  borderRadius: 10,
                  background: theme.panel,
                  border: `1px solid ${theme.border}`,
                  fontFamily: monoStack,
                  fontSize: 26,
                  color: theme.text,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.45), inset 0 -3px 0 rgba(0,0,0,0.4)',
                  transform: `translate(${translateX}px, ${translateY}px) rotate(${rotate}deg) scale(${s})`,
                  opacity: s
                }}
              >
                {tok.t}
              </span>
            )
          }
          return (
            <span
              key={i}
              style={{
                fontSize: 36,
                fontWeight: 600,
                letterSpacing: -0.5,
                transform: `translate(${translateX}px, ${translateY}px) rotate(${rotate}deg) scale(${s})`,
                opacity: s
              }}
            >
              {tok.t}
            </span>
          )
        })}
      </div>

      {/* Subtitle */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, 230px)',
          fontFamily: monoStack,
          fontSize: 16,
          color: theme.textDim,
          letterSpacing: 3,
          textTransform: 'uppercase',
          opacity: interpolate(localFrame, [56, 72], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
          })
        }}
      >
        to open the tutorials library
      </div>
    </AbsoluteFill>
  )
}

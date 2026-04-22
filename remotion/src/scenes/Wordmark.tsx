import { AbsoluteFill, interpolate, spring, useVideoConfig } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { seeded } from '../math'

interface WordmarkProps {
  localFrame: number
  durationInFrames: number
}

/**
 * Kinetic typography: each letter of "AgentCanvas" arrives from 3D depth
 * with a per-letter spring stagger, chromatic aberration fringing that
 * resolves on landing, and a tagline that assembles word-by-word.
 */
export const Wordmark: React.FC<WordmarkProps> = ({ localFrame, durationInFrames }) => {
  const { fps } = useVideoConfig()
  const word = 'AgentCanvas'
  const letters = word.split('')

  const tagWords = ['An', 'infinite', 'canvas', 'for', 'your', 'work.']

  // Scene-level opacity for enter/exit
  const sceneAlpha = interpolate(
    localFrame,
    [0, 6, durationInFrames - 10, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  // Whole block slight pull-back on exit (setup for next scene's zoom-in)
  const exitScale = interpolate(
    localFrame,
    [durationInFrames - 14, durationInFrames],
    [1, 0.82],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
  const exitBlur = interpolate(
    localFrame,
    [durationInFrames - 14, durationInFrames],
    [0, 6],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: fontStack,
        color: theme.text,
        opacity: sceneAlpha,
        filter: `blur(${exitBlur}px)`,
        transform: `scale(${exitScale})`,
        perspective: '900px'
      }}
    >
      {/* Underline beam that draws in behind the wordmark */}
      <BeamBackdrop localFrame={localFrame} />

      <div style={{ display: 'flex', perspective: '900px' }}>
        {letters.map((ch, i) => {
          const start = 2 + i * 2.4
          const letterSpring = spring({
            frame: Math.max(0, localFrame - start),
            fps,
            config: { damping: 11, stiffness: 150, mass: 0.55 }
          })
          const landed = Math.min(1, letterSpring)

          const rotateX = interpolate(landed, [0, 1], [-70, 0])
          const rotateZ = interpolate(landed, [0, 1], [seeded(i + 1) * 30 - 15, 0])
          const translateZ = interpolate(landed, [0, 1], [-500, 0])
          const translateY = interpolate(landed, [0, 1], [60, 0])
          const scale = interpolate(landed, [0, 1], [0.4, 1])

          // Chromatic aberration that resolves as the letter lands
          const chroma = (1 - landed) * 8
          const filter = `drop-shadow(${chroma}px 0 0 rgba(236,72,153,0.8)) drop-shadow(${-chroma}px 0 0 rgba(34,211,238,0.8))`

          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                fontSize: 120,
                fontWeight: 800,
                letterSpacing: -4,
                lineHeight: 1,
                color: theme.text,
                transform: `translate3d(0, ${translateY}px, ${translateZ}px) rotateX(${rotateX}deg) rotateZ(${rotateZ}deg) scale(${scale})`,
                transformStyle: 'preserve-3d',
                filter,
                opacity: landed
              }}
            >
              {ch}
            </span>
          )
        })}
      </div>

      {/* Tagline — word-by-word kinetic arrival */}
      <div
        style={{
          marginTop: 28,
          display: 'flex',
          gap: 12,
          fontSize: 24,
          color: theme.textMuted,
          fontFamily: monoStack
        }}
      >
        {tagWords.map((w, i) => {
          const start = 30 + i * 3
          const s = spring({
            frame: Math.max(0, localFrame - start),
            fps,
            config: { damping: 18, stiffness: 130 }
          })
          const translateY = interpolate(s, [0, 1], [14, 0])
          const rotate = interpolate(s, [0, 1], [(seeded(i + 20) - 0.5) * 12, 0])
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                opacity: s,
                transform: `translateY(${translateY}px) rotate(${rotate}deg)`,
                color: i === 1 ? theme.blue : undefined
              }}
            >
              {w}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

// ── Animated horizon beam behind the wordmark ──
const BeamBackdrop: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const draw = interpolate(localFrame, [0, 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const width = draw * 980
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(50% + 110px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width,
        height: 2,
        background: `linear-gradient(90deg, transparent, ${theme.blue}, transparent)`,
        boxShadow: `0 0 24px ${theme.blue}`,
        opacity: 0.8
      }}
    />
  )
}

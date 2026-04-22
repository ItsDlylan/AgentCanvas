import { AbsoluteFill, interpolate, useVideoConfig } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { seeded } from '../math'
import { blurResolve, scrambleText, skewIn, springAt, wipeReveal } from '../kinetic'

interface WordmarkProps {
  localFrame: number
  durationInFrames: number
}

/**
 * "AgentCanvas" wordmark with advanced kinetic typography:
 *  - Letters arrive from 3D depth (translate3d + rotateX/Z) with per-letter
 *    spring stagger, chromatic-aberration split that resolves on landing.
 *  - BEFORE each letter locks, it *scrambles* through random glyphs so
 *    the reveal feels like a cipher resolving rather than a slide.
 *  - When fully formed the wordmark pulses with a subtle breathe + pulse ring.
 *  - The tagline uses four distinct entry techniques — no two words
 *    animate the same way.
 */
export const Wordmark: React.FC<WordmarkProps> = ({ localFrame, durationInFrames }) => {
  const { fps } = useVideoConfig()
  const word = 'AgentCanvas'
  const letters = word.split('')

  // Scene fade envelope
  const sceneAlpha = interpolate(
    localFrame,
    [0, 8, durationInFrames - 14, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  // Exit: entire block gets pulled backwards + blurred so the next scene's
  // starfield feels like a continuation (we're receding into space).
  const exitProgress = interpolate(
    localFrame,
    [durationInFrames - 18, durationInFrames],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
  const exitScale = 1 - exitProgress * 0.35
  const exitTranslateZ = -exitProgress * 420
  const exitBlur = exitProgress * 8

  // Post-reveal breath (starts after all letters locked, ~frame 42)
  const breathT = Math.max(0, localFrame - 46)
  const breathe = 1 + Math.sin(breathT / 8) * 0.012

  // Pulse-ring that emits from behind the mark once locked
  const ringProgress = interpolate(localFrame, [48, 78], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const ringRadius = 80 + ringProgress * 520
  const ringAlpha = (1 - ringProgress) * 0.5

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
        perspective: '1200px'
      }}
    >
      {/* Starfield whisper that hints at the next scene. */}
      <BackgroundWhisper localFrame={localFrame} />

      {/* Pulse ring */}
      {ringAlpha > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: ringRadius * 2,
            height: ringRadius * 2,
            borderRadius: 999,
            border: `2px solid ${theme.blue}`,
            transform: 'translate(-50%, -50%)',
            opacity: ringAlpha,
            boxShadow: `0 0 40px ${theme.blue}`,
            pointerEvents: 'none'
          }}
        />
      )}

      <div
        style={{
          display: 'flex',
          perspective: '1400px',
          transformStyle: 'preserve-3d',
          transform: `scale(${breathe * exitScale}) translateZ(${exitTranslateZ}px)`,
          filter: `blur(${exitBlur}px)`
        }}
      >
        {letters.map((ch, i) => {
          const delay = 2 + i * 2
          const landed = springAt(localFrame, delay, fps, {
            damping: 11,
            stiffness: 160,
            mass: 0.5
          })
          const l = Math.min(1, landed)

          const rotateX = interpolate(l, [0, 1], [-80, 0])
          const rotateZ = interpolate(l, [0, 1], [seeded(i + 1) * 40 - 20, 0])
          const rotateY = interpolate(l, [0, 1], [seeded(i + 9) * 30 - 15, 0])
          const translateZ = interpolate(l, [0, 1], [-620, 0])
          const translateY = interpolate(l, [0, 1], [72, 0])
          const scale = interpolate(l, [0, 1], [0.35, 1])

          // Scramble window per letter: starts just before the land spring
          // becomes visible, ends as the spring settles (~l > 0.9)
          const scrambleStart = delay + 2
          const scrambleEnd = delay + 18
          const locked = localFrame >= scrambleEnd
          const displayChar = locked
            ? ch
            : scrambleText(ch, localFrame, scrambleStart, scrambleEnd, i + 11)

          // Chromatic aberration that intensifies during scramble and
          // resolves to zero once locked.
          const chroma = Math.max(0, (1 - l) * 9)
          const filter = `drop-shadow(${chroma}px 0 0 rgba(236,72,153,0.9)) drop-shadow(${-chroma}px 0 0 rgba(34,211,238,0.9))`

          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                fontSize: 132,
                fontWeight: 800,
                letterSpacing: -4.5,
                lineHeight: 1,
                color: theme.text,
                fontFamily: fontStack,
                transform: `translate3d(0, ${translateY}px, ${translateZ}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg) scale(${scale})`,
                transformStyle: 'preserve-3d',
                transformOrigin: 'center bottom',
                filter,
                opacity: l
              }}
            >
              {displayChar}
            </span>
          )
        })}
      </div>

      {/* Tagline — four words, four distinct motion techniques. */}
      <TaglineRow localFrame={localFrame} fps={fps} />
    </AbsoluteFill>
  )
}

// ── Tagline row ──
// Each word arrives with a *fundamentally* different technique so nothing
// reads as a slide.
const TaglineRow: React.FC<{ localFrame: number; fps: number }> = ({
  localFrame,
  fps
}) => {
  const startBase = 32

  return (
    <div
      style={{
        marginTop: 34,
        display: 'flex',
        alignItems: 'baseline',
        gap: 14,
        fontSize: 26,
        color: theme.textMuted,
        fontFamily: monoStack
      }}
    >
      {/* 1. "The" — blur-resolve */}
      <BlurWord text="The" startFrame={startBase} color={theme.textMuted} />

      {/* 2. "infinite" — per-letter 3D flip (rotateY) with scramble */}
      <FlipScrambleWord
        text="infinite"
        startFrame={startBase + 4}
        color={theme.blue}
        fps={fps}
        localFrame={localFrame}
      />

      {/* 3. "canvas" — wipe reveal (mask sweeps open) */}
      <WipeWord text="canvas" startFrame={startBase + 10} color={theme.textMuted} />

      {/* 4. "for agents." — skew-in */}
      <SkewWord text="for agents." startFrame={startBase + 16} color={theme.textMuted} />
    </div>
  )
}

const BlurWord: React.FC<{ text: string; startFrame: number; color: string }> = ({
  text,
  startFrame,
  color
}) => {
  const { opacity, blurPx, scale } = blurResolve(
    useFrame(),
    startFrame,
    10
  )
  return (
    <span
      style={{
        display: 'inline-block',
        opacity,
        filter: `blur(${blurPx}px)`,
        transform: `scale(${scale})`,
        color
      }}
    >
      {text}
    </span>
  )
}

const FlipScrambleWord: React.FC<{
  text: string
  startFrame: number
  color: string
  fps: number
  localFrame: number
}> = ({ text, startFrame, color, localFrame, fps }) => {
  const chars = text.split('')
  return (
    <span style={{ display: 'inline-flex', gap: 0, perspective: '800px' }}>
      {chars.map((ch, i) => {
        const perCharStart = startFrame + i * 1.4
        const s = springAt(localFrame, perCharStart, fps, {
          damping: 13,
          stiffness: 150
        })
        const rotY = (1 - s) * 120
        const scrambleEnd = perCharStart + 10
        const locked = localFrame >= scrambleEnd
        const shown = locked
          ? ch
          : scrambleText(ch, localFrame, perCharStart, scrambleEnd, i + 41)
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              transform: `rotateY(${rotY}deg) scale(${0.7 + s * 0.3})`,
              opacity: s,
              color,
              transformStyle: 'preserve-3d'
            }}
          >
            {shown}
          </span>
        )
      })}
    </span>
  )
}

const WipeWord: React.FC<{ text: string; startFrame: number; color: string }> = ({
  text,
  startFrame,
  color
}) => {
  const localFrame = useFrame()
  const clip = wipeReveal(localFrame, startFrame, 14, 'left')
  const opacity = interpolate(localFrame, [startFrame, startFrame + 4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  return (
    <span
      style={{
        display: 'inline-block',
        color,
        clipPath: clip,
        WebkitClipPath: clip,
        opacity,
        textShadow: '0 0 12px rgba(59,130,246,0.35)'
      }}
    >
      {text}
    </span>
  )
}

const SkewWord: React.FC<{ text: string; startFrame: number; color: string }> = ({
  text,
  startFrame,
  color
}) => {
  const localFrame = useFrame()
  const { skewX, opacity, translateY } = skewIn(localFrame, startFrame, 16, 45)
  return (
    <span
      style={{
        display: 'inline-block',
        transform: `translateY(${translateY}px) skewX(${skewX}deg)`,
        opacity,
        color
      }}
    >
      {text}
    </span>
  )
}

// Tiny helper — avoids importing useCurrentFrame in each child
import { useCurrentFrame } from 'remotion'
function useFrame(): number {
  return useCurrentFrame()
}

// ── Background whisper: faint warping dot field that hints at stars ──
const BackgroundWhisper: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const cols = 22
  const rows = 12
  const dots: React.ReactNode[] = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x
      const base = 0.06 + 0.08 * (0.5 + 0.5 * Math.sin((localFrame + idx * 7) / 22))
      const perspective = Math.abs((x - cols / 2) / (cols / 2)) * 0.4
      dots.push(
        <circle
          key={idx}
          cx={(x + 0.5) * (1280 / cols)}
          cy={(y + 0.5) * (720 / rows)}
          r={1 + perspective}
          fill="#ffffff"
          opacity={base * (1 - perspective * 0.5)}
        />
      )
    }
  }
  return (
    <svg
      width={1280}
      height={720}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {dots}
    </svg>
  )
}

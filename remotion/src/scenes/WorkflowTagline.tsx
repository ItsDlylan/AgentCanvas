import { AbsoluteFill, interpolate, useVideoConfig } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { seeded } from '../math'
import { blurResolve, scrambleText, skewIn, springAt, wipeReveal } from '../kinetic'
import { useCurrentFrame } from 'remotion'

interface WorkflowTaglineProps {
  localFrame: number
  durationInFrames: number
}

/**
 * "AgentCanvas — the workflow built to ship the world."
 *
 * Every word gets a fundamentally different kinetic-typography entry so
 * the line reads like a sentence being *assembled*, not slid in:
 *
 *   AgentCanvas  → chromatic glitch + 3D Y-axis flip (preserve-3d)
 *   the          → blur-to-sharp
 *   workflow     → scramble + character-stagger fade
 *   built        → mask-wipe from left
 *   to           → typewriter cursor insert
 *   ship         → skew-unskew with scale pop
 *   the          → blur-to-sharp (matches first "the" for rhythm)
 *   world.       → final word expands and leads into the globe scene
 */
export const WorkflowTagline: React.FC<WorkflowTaglineProps> = ({
  localFrame,
  durationInFrames
}) => {
  const { fps } = useVideoConfig()

  const sceneAlpha = interpolate(
    localFrame,
    [0, 6, durationInFrames - 12, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  // The final word "world." zooms up over exit to lead into the globe
  const worldZoom = interpolate(
    localFrame,
    [durationInFrames - 18, durationInFrames],
    [1, 2.1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
  const worldBlur = interpolate(
    localFrame,
    [durationInFrames - 18, durationInFrames],
    [0, 10],
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
        padding: 60
      }}
    >
      {/* Decorative spotlight */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background:
            'radial-gradient(ellipse at center, rgba(59,130,246,0.1), transparent 60%)',
          pointerEvents: 'none'
        }}
      />

      {/* Line 1: AgentCanvas (big, standalone) */}
      <div
        style={{
          perspective: '1200px',
          transformStyle: 'preserve-3d',
          marginBottom: 32
        }}
      >
        <AgentCanvasGlitch localFrame={localFrame} fps={fps} />
      </div>

      {/* Line 2: "the workflow" */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          fontSize: 42,
          marginBottom: 12,
          color: theme.textMuted,
          fontFamily: monoStack
        }}
      >
        <BlurWord text="the" startFrame={20} />
        <ScrambleWord text="workflow" startFrame={24} color={theme.blue} fps={fps} />
      </div>

      {/* Line 3: "built to ship the world." */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          fontSize: 56,
          fontWeight: 700,
          letterSpacing: -1.5,
          color: theme.text
        }}
      >
        <WipeWord text="built" startFrame={38} />
        <TypewriterWord text="to" startFrame={46} color={theme.textMuted} />
        <SkewScaleWord text="ship" startFrame={52} color="#e4e4e7" />
        <BlurWord text="the" startFrame={62} fontSize={56} fontWeight={700} />
        <WorldWord
          startFrame={68}
          localFrame={localFrame}
          fps={fps}
          exitScale={worldZoom}
          exitBlur={worldBlur}
        />
      </div>
    </AbsoluteFill>
  )
}

// ── "AgentCanvas" with chromatic glitch + per-letter 3D Y flip ──
const AgentCanvasGlitch: React.FC<{ localFrame: number; fps: number }> = ({
  localFrame,
  fps
}) => {
  const word = 'AgentCanvas'
  const chars = word.split('')
  return (
    <div style={{ display: 'flex' }}>
      {chars.map((ch, i) => {
        const start = i * 1.4
        const s = springAt(localFrame, start, fps, {
          damping: 12,
          stiffness: 170,
          mass: 0.55
        })
        const l = Math.min(1, s)
        const rotY = (1 - l) * 140
        const translateY = (1 - l) * 32
        const scale = interpolate(l, [0, 1], [0.4, 1])
        const scrambleEnd = start + 14
        const locked = localFrame >= scrambleEnd
        const shown = locked
          ? ch
          : scrambleText(ch, localFrame, start, scrambleEnd, i + 5)
        const chroma = (1 - l) * 7
        const filter = `drop-shadow(${chroma}px 0 0 rgba(236,72,153,0.85)) drop-shadow(${-chroma}px 0 0 rgba(34,211,238,0.85))`
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              fontSize: 84,
              fontWeight: 800,
              letterSpacing: -3,
              color: theme.text,
              transform: `translateY(${translateY}px) rotateY(${rotY}deg) scale(${scale})`,
              transformStyle: 'preserve-3d',
              filter,
              opacity: l
            }}
          >
            {shown}
          </span>
        )
      })}
    </div>
  )
}

// ── Blur-to-sharp word ──
const BlurWord: React.FC<{
  text: string
  startFrame: number
  fontSize?: number
  fontWeight?: number
}> = ({ text, startFrame, fontSize, fontWeight }) => {
  const localFrame = useCurrentFrame()
  const { opacity, blurPx, scale } = blurResolve(localFrame, startFrame, 12)
  return (
    <span
      style={{
        display: 'inline-block',
        opacity,
        filter: `blur(${blurPx}px)`,
        transform: `scale(${scale})`,
        color: theme.textMuted,
        fontSize,
        fontWeight
      }}
    >
      {text}
    </span>
  )
}

// ── Scramble + per-char fade word ──
const ScrambleWord: React.FC<{
  text: string
  startFrame: number
  color: string
  fps: number
}> = ({ text, startFrame, color, fps }) => {
  const localFrame = useCurrentFrame()
  const chars = text.split('')
  return (
    <span style={{ display: 'inline-flex' }}>
      {chars.map((ch, i) => {
        const perStart = startFrame + i * 1.2
        const s = springAt(localFrame, perStart, fps, { damping: 16, stiffness: 160 })
        const scrambleEnd = perStart + 12
        const locked = localFrame >= scrambleEnd
        const shown = locked
          ? ch
          : scrambleText(ch, localFrame, perStart, scrambleEnd, i + 21)
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              color,
              opacity: s,
              transform: `translateY(${(1 - s) * 6}px) scale(${0.85 + s * 0.15})`
            }}
          >
            {shown}
          </span>
        )
      })}
    </span>
  )
}

// ── Mask-wipe word ──
const WipeWord: React.FC<{ text: string; startFrame: number }> = ({ text, startFrame }) => {
  const localFrame = useCurrentFrame()
  const clip = wipeReveal(localFrame, startFrame, 14, 'left')
  const opacity = interpolate(localFrame, [startFrame, startFrame + 4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  return (
    <span
      style={{
        display: 'inline-block',
        clipPath: clip,
        WebkitClipPath: clip,
        opacity,
        color: theme.text,
        textShadow: `0 0 16px ${theme.blue}55`
      }}
    >
      {text}
    </span>
  )
}

// ── Typewriter with cursor ──
const TypewriterWord: React.FC<{
  text: string
  startFrame: number
  color: string
}> = ({ text, startFrame, color }) => {
  const localFrame = useCurrentFrame()
  if (localFrame < startFrame) return null
  const revealed = Math.min(text.length, Math.floor((localFrame - startFrame) * 1.2))
  const done = revealed >= text.length
  const cursorVisible = Math.floor(localFrame / 6) % 2 === 0
  return (
    <span style={{ display: 'inline-block', color, fontFamily: monoStack, fontSize: 48 }}>
      {text.slice(0, revealed)}
      {(!done || (done && cursorVisible && localFrame - startFrame < text.length * 2))
        ? <span style={{ color: theme.blue }}>▎</span>
        : null}
    </span>
  )
}

// ── Skew-unskew with scale pop ──
const SkewScaleWord: React.FC<{
  text: string
  startFrame: number
  color: string
}> = ({ text, startFrame, color }) => {
  const localFrame = useCurrentFrame()
  const { skewX, opacity, translateY } = skewIn(localFrame, startFrame, 14, 50)
  const t = interpolate(localFrame, [startFrame, startFrame + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const scale = interpolate(t, [0, 0.55, 1], [0.6, 1.18, 1])
  return (
    <span
      style={{
        display: 'inline-block',
        transform: `translateY(${translateY}px) skewX(${skewX}deg) scale(${scale})`,
        opacity,
        color
      }}
    >
      {text}
    </span>
  )
}

// ── "world." — letters orbit in from scattered points, settle, then zoom ──
const WorldWord: React.FC<{
  startFrame: number
  localFrame: number
  fps: number
  exitScale: number
  exitBlur: number
}> = ({ startFrame, localFrame, fps, exitScale, exitBlur }) => {
  const chars = 'world.'.split('')
  return (
    <span
      style={{
        display: 'inline-flex',
        transform: `scale(${exitScale})`,
        transformOrigin: 'center center',
        filter: `blur(${exitBlur}px)`,
        color: theme.blue,
        textShadow: `0 0 24px ${theme.blue}88`
      }}
    >
      {chars.map((ch, i) => {
        const perStart = startFrame + i * 1.5
        const s = springAt(localFrame, perStart, fps, {
          damping: 14,
          stiffness: 130,
          mass: 0.7
        })
        const orbitAngle = (seeded(i + 30) - 0.5) * Math.PI * 2
        const orbitRadius = 160
        const fromX = Math.cos(orbitAngle) * orbitRadius
        const fromY = Math.sin(orbitAngle) * orbitRadius
        const rotate = (1 - s) * (seeded(i + 41) - 0.5) * 200
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              transform: `translate(${(1 - s) * fromX}px, ${(1 - s) * fromY}px) rotate(${rotate}deg) scale(${0.3 + s * 0.7})`,
              opacity: s
            }}
          >
            {ch}
          </span>
        )
      })}
    </span>
  )
}

import { AbsoluteFill, interpolate, useVideoConfig } from 'remotion'
import { useCurrentFrame } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { easeOutExpo, seeded } from '../math'
import { scrambleText, springAt, wipeReveal } from '../kinetic'

interface OutroProps {
  localFrame: number
  durationInFrames: number
}

/**
 * Final card. Text does NOT slide:
 *  - "Press" arrives via character scramble + stagger fade.
 *  - Each modifier key does a 3D `rotateX` press-in (keycap depressing)
 *    with a shadow that deepens then settles.
 *  - "anytime" reveals via mask-wipe with a chromatic fringe pass.
 *  - Sub-line typewrites with cursor blink.
 *  - Background is the constellation with a lingering pulse ring.
 */
export const Outro: React.FC<OutroProps> = ({ localFrame, durationInFrames }) => {
  const { fps } = useVideoConfig()
  const W = 1280
  const H = 720

  const sceneAlpha = interpolate(
    localFrame,
    [0, 8, durationInFrames - 14, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  // Starfield with drift
  const stars = Array.from({ length: 140 }, (_, i) => {
    const baseX = seeded(i + 1) * W
    const baseY = seeded(i + 9) * H
    const driftX = Math.sin((localFrame + i * 5) / 60) * 5
    const driftY = Math.cos((localFrame + i * 7) / 80) * 3
    const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((localFrame + i * 11) / 12))
    return {
      i,
      x: baseX + driftX,
      y: baseY + driftY,
      r: 0.8 + seeded(i + 17) * 1.4,
      a: twinkle * (0.3 + 0.7 * seeded(i + 23))
    }
  })

  // Central pulse ring (fades in around frame 10)
  const pulseT = ((localFrame - 12) % 38) / 38
  const pulseRadius = 70 + easeOutExpo(pulseT) * 280
  const pulseAlpha = localFrame < 12 ? 0 : 1 - pulseT

  // Keycap for the central `?` — scale-in + breathing
  const capSpring = springAt(localFrame, 2, fps, {
    damping: 11,
    stiffness: 130,
    mass: 0.6
  })
  const breathing = 1 + Math.sin(localFrame / 8) * 0.014

  return (
    <AbsoluteFill style={{ background: theme.bg, opacity: sceneAlpha, overflow: 'hidden' }}>
      {/* Stars */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {stars.map((s) => (
          <circle key={s.i} cx={s.x} cy={s.y} r={s.r} fill="#ffffff" opacity={s.a} />
        ))}
      </svg>

      {/* Pulse ring */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none'
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

      {/* Central ? keycap */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 150,
          height: 150,
          transform: `translate(-50%, -50%) scale(${capSpring * breathing})`,
          borderRadius: 30,
          background: `linear-gradient(135deg, ${theme.blue} 0%, #6366f1 100%)`,
          boxShadow:
            '0 30px 80px rgba(59,130,246,0.55), inset 0 -6px 0 rgba(0,0,0,0.3), inset 0 2px 0 rgba(255,255,255,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontFamily: fontStack,
          fontSize: 92,
          fontWeight: 800,
          lineHeight: 1
        }}
      >
        ?
      </div>

      {/* Kinetic text row below keycap: "Press ⌘ ⇧ ? anytime" */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, 150px)',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          fontFamily: fontStack,
          color: theme.text
        }}
      >
        <ScrambleStaggerWord text="Press" startFrame={22} fps={fps} />
        <KeyPressCap symbol="⌘" startFrame={32} fps={fps} />
        <KeyPressCap symbol="⇧" startFrame={38} fps={fps} />
        <KeyPressCap symbol="?" startFrame={44} fps={fps} accent />
        <WipeChromaticWord text="anytime" startFrame={52} />
      </div>

      {/* Subtitle (typewriter) */}
      <SubtitleTypewriter />
    </AbsoluteFill>
  )
}

// ── Word with per-char scramble + stagger ──
const ScrambleStaggerWord: React.FC<{
  text: string
  startFrame: number
  fps: number
}> = ({ text, startFrame, fps }) => {
  const localFrame = useCurrentFrame()
  const chars = text.split('')
  return (
    <span
      style={{ display: 'inline-flex', fontSize: 38, fontWeight: 700, letterSpacing: -0.5 }}
    >
      {chars.map((ch, i) => {
        const perStart = startFrame + i * 1.6
        const s = springAt(localFrame, perStart, fps, { damping: 16, stiffness: 160 })
        const scrambleEnd = perStart + 12
        const locked = localFrame >= scrambleEnd
        const shown = locked
          ? ch
          : scrambleText(ch, localFrame, perStart, scrambleEnd, i + 101)
        const translateY = (1 - s) * 8
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              transform: `translateY(${translateY}px) scale(${0.85 + s * 0.15})`,
              opacity: s,
              color: theme.text
            }}
          >
            {shown}
          </span>
        )
      })}
    </span>
  )
}

// ── Keycap that press-down on entry ──
const KeyPressCap: React.FC<{
  symbol: string
  startFrame: number
  fps: number
  accent?: boolean
}> = ({ symbol, startFrame, fps, accent }) => {
  const localFrame = useCurrentFrame()
  const s = springAt(localFrame, startFrame, fps, {
    damping: 10,
    stiffness: 200,
    mass: 0.5
  })
  // Press-down sequence: from rotateX -60 (tilted back) → +10 overshoot → 0
  const rotX = interpolate(s, [0, 0.55, 1], [-60, 12, 0])
  const translateY = interpolate(s, [0, 0.55, 1], [-14, 6, 0])
  const scale = interpolate(s, [0, 0.55, 1], [1.25, 0.92, 1])
  const shadowDepth = interpolate(s, [0, 0.55, 1], [2, 0, 6])

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 54,
        height: 54,
        padding: '0 10px',
        borderRadius: 12,
        background: accent
          ? `linear-gradient(135deg, ${theme.blue} 0%, #6366f1 100%)`
          : theme.panel,
        border: `1px solid ${accent ? theme.blue : theme.border}`,
        fontFamily: monoStack,
        fontSize: 28,
        color: accent ? '#fff' : theme.text,
        transform: `perspective(400px) translateY(${translateY}px) rotateX(${rotX}deg) scale(${scale})`,
        transformStyle: 'preserve-3d',
        transformOrigin: 'center bottom',
        boxShadow: `0 ${shadowDepth}px ${8 + shadowDepth}px rgba(0,0,0,0.5), inset 0 -3px 0 rgba(0,0,0,0.4)`,
        opacity: s
      }}
    >
      {symbol}
    </span>
  )
}

// ── Mask wipe with chromatic aberration pass ──
const WipeChromaticWord: React.FC<{
  text: string
  startFrame: number
}> = ({ text, startFrame }) => {
  const localFrame = useCurrentFrame()
  const clip = wipeReveal(localFrame, startFrame, 18, 'left')
  const opacity = interpolate(localFrame, [startFrame, startFrame + 4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  // Chromatic fringe that rides the wipe edge
  const t = interpolate(localFrame, [startFrame, startFrame + 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const chroma = (1 - t) * 10

  return (
    <span
      style={{
        display: 'inline-block',
        clipPath: clip,
        WebkitClipPath: clip,
        opacity,
        color: theme.text,
        fontSize: 38,
        fontWeight: 700,
        letterSpacing: -0.5,
        filter: `drop-shadow(${chroma}px 0 0 rgba(236,72,153,0.85)) drop-shadow(${-chroma}px 0 0 rgba(34,211,238,0.85))`,
        textShadow: `0 0 18px ${theme.blue}66`
      }}
    >
      {text}
    </span>
  )
}

// ── Subtitle typewriter ──
const SubtitleTypewriter: React.FC = () => {
  const localFrame = useCurrentFrame()
  const fullLine = 'to open the tutorials library'
  const startFrame = 66
  const typedLen = Math.max(0, Math.min(fullLine.length, Math.floor((localFrame - startFrame) * 1.3)))
  const cursorVisible = Math.floor(localFrame / 6) % 2 === 0
  const opacity = interpolate(localFrame, [startFrame, startFrame + 4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, 250px)',
        fontFamily: monoStack,
        fontSize: 15,
        color: theme.textDim,
        letterSpacing: 3,
        textTransform: 'uppercase',
        opacity
      }}
    >
      {fullLine.toUpperCase().slice(0, typedLen)}
      {typedLen < fullLine.length && cursorVisible ? '▎' : ''}
    </div>
  )
}

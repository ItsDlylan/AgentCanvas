import { AbsoluteFill, interpolate, useVideoConfig } from 'remotion'
import { useCurrentFrame } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { easeInOut, seeded } from '../math'
import { blurResolve, scrambleText, skewIn, springAt, wipeReveal } from '../kinetic'

interface WorkflowGlobeProps {
  localFrame: number
  durationInFrames: number
}

/**
 * Combined scene: the wireframe globe spins in the CENTRE while the
 * workflow tagline assembles in the space above and below it. The
 * text does not slide — every word uses a distinct kinetic technique
 * (chromatic glitch, scramble, mask wipe, typewriter, skew-pop,
 * blur-resolve, orbit-in).
 *
 * Globe parameters are scaled down slightly vs standalone GlobeSpin
 * to leave vertical breathing room for the tagline.
 */
export const WorkflowGlobe: React.FC<WorkflowGlobeProps> = ({
  localFrame,
  durationInFrames
}) => {
  const { fps } = useVideoConfig()
  const W = 1280
  const H = 720
  const cx = W / 2
  const cy = H / 2
  const R = 180 // smaller globe — leaves room for text

  const sceneAlpha = interpolate(
    localFrame,
    [0, 8, durationInFrames - 12, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  // Globe entrance + rotation + tilt sweep
  const enter = springAt(localFrame, 0, fps, { damping: 13, stiffness: 100, mass: 0.8 })
  const radius = R * enter
  const longitude = ((localFrame / 95) * 360 * Math.PI) / 180
  const tiltDeg = interpolate(localFrame, [0, durationInFrames], [14, -8], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const tilt = (tiltDeg * Math.PI) / 180
  const sinT = Math.sin(tilt)
  const cosT = Math.cos(tilt)

  function project(latRad: number, lonRad: number) {
    const lonAdj = lonRad + longitude
    const x = Math.cos(latRad) * Math.sin(lonAdj)
    const y = Math.sin(latRad)
    const z = Math.cos(latRad) * Math.cos(lonAdj)
    const yRot = y * cosT - z * sinT
    const zRot = y * sinT + z * cosT
    return {
      x: cx + x * radius,
      y: cy - yRot * radius,
      z: zRot,
      visible: zRot > -0.05
    }
  }

  // Build meridians & parallels
  const meridianPaths: string[] = []
  for (let lonDeg = -180; lonDeg < 180; lonDeg += 20) {
    const pts: string[] = []
    for (let latDeg = -90; latDeg <= 90; latDeg += 4) {
      const p = project((latDeg * Math.PI) / 180, (lonDeg * Math.PI) / 180)
      pts.push(p.visible ? `${pts.length ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : 'M 0 0')
    }
    meridianPaths.push(pts.join(' '))
  }
  const parallelPaths: string[] = []
  for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
    const pts: string[] = []
    for (let lonDeg = -180; lonDeg <= 180; lonDeg += 4) {
      const p = project((latDeg * Math.PI) / 180, (lonDeg * Math.PI) / 180)
      pts.push(p.visible ? `${pts.length ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : 'M 0 0')
    }
    parallelPaths.push(pts.join(' '))
  }

  // Cities
  const cities = [
    { name: 'SF', lat: 37.77, lon: -122.42 },
    { name: 'NYC', lat: 40.71, lon: -74.0 },
    { name: 'LDN', lat: 51.5, lon: -0.12 },
    { name: 'BLN', lat: 52.52, lon: 13.4 },
    { name: 'TYO', lat: 35.68, lon: 139.69 },
    { name: 'SYD', lat: -33.87, lon: 151.21 },
    { name: 'BLR', lat: 12.97, lon: 77.59 },
    { name: 'SAO', lat: -23.55, lon: -46.63 }
  ]
  const projectedCities = cities.map((c) => ({
    ...c,
    p: project((c.lat * Math.PI) / 180, (c.lon * Math.PI) / 180)
  }))
  const arcPairs: [number, number][] = [
    [0, 2],
    [1, 5],
    [3, 4],
    [6, 0],
    [2, 7]
  ]

  // "world." at the end zooms into the globe as an outro flourish
  const worldZoom = interpolate(
    localFrame,
    [durationInFrames - 22, durationInFrames - 2],
    [1, 2.4],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
  const worldBlur = interpolate(
    localFrame,
    [durationInFrames - 22, durationInFrames - 2],
    [0, 12],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  return (
    <AbsoluteFill style={{ background: theme.bg, opacity: sceneAlpha, overflow: 'hidden' }}>
      {/* Background stars */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {Array.from({ length: 140 }, (_, i) => (
          <circle
            key={i}
            cx={seeded(i + 1) * W}
            cy={seeded(i + 9) * H}
            r={0.8 + seeded(i + 17) * 1.2}
            fill="#ffffff"
            opacity={0.2 + seeded(i + 23) * 0.5}
          />
        ))}
      </svg>

      {/* Soft glow behind globe */}
      <div
        style={{
          position: 'absolute',
          left: cx - radius * 1.6,
          top: cy - radius * 1.6,
          width: radius * 3.2,
          height: radius * 3.2,
          borderRadius: 999,
          background: `radial-gradient(circle, ${theme.blue}33 0%, transparent 60%)`,
          filter: `blur(40px)`
        }}
      />

      {/* Globe */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="globeCore" cx="45%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#1e293b" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#030712" stopOpacity={1} />
          </radialGradient>
          <filter id="wireGlow">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>

        {/* Filled sphere */}
        <circle cx={cx} cy={cy} r={radius} fill="url(#globeCore)" opacity={enter} />

        {/* Outer rim */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={theme.blue}
          strokeOpacity={0.35}
          strokeWidth={1.5}
          filter="url(#wireGlow)"
        />

        {parallelPaths.map((d, i) => (
          <path key={`par-${i}`} d={d} stroke={theme.blue} strokeOpacity={0.22} strokeWidth={1} fill="none" />
        ))}
        {meridianPaths.map((d, i) => (
          <path key={`mer-${i}`} d={d} stroke={theme.blue} strokeOpacity={0.22} strokeWidth={1} fill="none" />
        ))}

        {/* Arcs */}
        {arcPairs.map(([a, b], i) => {
          const pa = projectedCities[a].p
          const pb = projectedCities[b].p
          if (!pa.visible && !pb.visible) return null
          const appearAt = 24 + i * 5
          const t = interpolate(localFrame, [appearAt, appearAt + 18], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
          })
          if (t <= 0) return null
          const midX = (pa.x + pb.x) / 2
          const midY = (pa.y + pb.y) / 2
          const dx = pb.x - pa.x
          const dy = pb.y - pa.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const curveHeight = Math.min(dist * 0.45, 120)
          const outX = midX + ((midX - cx) / (Math.hypot(midX - cx, midY - cy) || 1)) * curveHeight * 0.3
          const outY = midY + ((midY - cy) / (Math.hypot(midX - cx, midY - cy) || 1)) * curveHeight * 0.9
          const path = `M ${pa.x} ${pa.y} Q ${outX} ${outY} ${pb.x} ${pb.y}`
          const dashLen = dist + curveHeight
          const offset = (1 - easeInOut(t)) * dashLen
          return (
            <path
              key={i}
              d={path}
              stroke="#93c5fd"
              strokeWidth={1.5}
              fill="none"
              strokeDasharray={dashLen}
              strokeDashoffset={offset}
              opacity={0.85}
            />
          )
        })}

        {/* City markers */}
        {projectedCities.map((c, i) => {
          if (!c.p.visible) return null
          const pulse = 0.7 + 0.3 * Math.sin((localFrame + i * 9) / 7)
          const appearAt = 8 + i * 3
          const appear = interpolate(localFrame, [appearAt, appearAt + 10], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
          })
          if (appear <= 0) return null
          const depthFade = Math.max(0.35, c.p.z)
          return (
            <g key={c.name} opacity={appear * depthFade}>
              <circle
                cx={c.p.x}
                cy={c.p.y}
                r={7 + pulse * 5}
                fill="none"
                stroke={theme.blue}
                strokeOpacity={0.25}
                strokeWidth={1.5}
              />
              <circle cx={c.p.x} cy={c.p.y} r={3} fill="#93c5fd" />
            </g>
          )
        })}
      </svg>

      {/* Text above the globe */}
      <div
        style={{
          position: 'absolute',
          top: 80,
          left: 0,
          right: 0,
          textAlign: 'center',
          color: theme.text,
          fontFamily: fontStack
        }}
      >
        <AgentCanvasGlitchLine localFrame={localFrame} fps={fps} />
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'baseline',
            gap: 12,
            fontSize: 32,
            color: theme.textMuted,
            fontFamily: monoStack
          }}
        >
          <BlurWord text="the" startFrame={22} />
          <ScrambleWord text="workflow" startFrame={26} color={theme.blue} fps={fps} />
        </div>
      </div>

      {/* Text below the globe */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: 0,
          right: 0,
          textAlign: 'center',
          color: theme.text,
          fontFamily: fontStack
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'baseline',
            gap: 14,
            fontSize: 46,
            fontWeight: 700,
            letterSpacing: -1.2,
            color: theme.text
          }}
        >
          <WipeWord text="built" startFrame={40} />
          <TypewriterWord text="to" startFrame={48} color={theme.textMuted} />
          <SkewScaleWord text="ship" startFrame={54} />
          <BlurWord text="the" startFrame={64} fontSize={46} fontWeight={700} />
          <WorldWord
            startFrame={70}
            localFrame={localFrame}
            fps={fps}
            exitScale={worldZoom}
            exitBlur={worldBlur}
          />
        </div>
      </div>

      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at center, transparent 55%, rgba(9,9,11,0.75) 100%)',
          pointerEvents: 'none'
        }}
      />
    </AbsoluteFill>
  )
}

// ── Text components ──

const AgentCanvasGlitchLine: React.FC<{ localFrame: number; fps: number }> = ({
  localFrame,
  fps
}) => {
  const word = 'AgentCanvas'
  return (
    <div
      style={{
        display: 'inline-flex',
        perspective: '1200px',
        transformStyle: 'preserve-3d'
      }}
    >
      {word.split('').map((ch, i) => {
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
              fontSize: 72,
              fontWeight: 800,
              letterSpacing: -2.5,
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

const ScrambleWord: React.FC<{
  text: string
  startFrame: number
  color: string
  fps: number
}> = ({ text, startFrame, color, fps }) => {
  const localFrame = useCurrentFrame()
  return (
    <span style={{ display: 'inline-flex' }}>
      {text.split('').map((ch, i) => {
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
    <span style={{ display: 'inline-block', color, fontFamily: monoStack, fontSize: 40 }}>
      {text.slice(0, revealed)}
      {!done || (done && cursorVisible && localFrame - startFrame < text.length * 2) ? (
        <span style={{ color: theme.blue }}>▎</span>
      ) : null}
    </span>
  )
}

const SkewScaleWord: React.FC<{ text: string; startFrame: number }> = ({
  text,
  startFrame
}) => {
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
        color: theme.text
      }}
    >
      {text}
    </span>
  )
}

const WorldWord: React.FC<{
  startFrame: number
  localFrame: number
  fps: number
  exitScale: number
  exitBlur: number
}> = ({ startFrame, localFrame, fps, exitScale, exitBlur }) => {
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
      {'world.'.split('').map((ch, i) => {
        const perStart = startFrame + i * 1.5
        const s = springAt(localFrame, perStart, fps, {
          damping: 14,
          stiffness: 130,
          mass: 0.7
        })
        const orbitAngle = (seeded(i + 30) - 0.5) * Math.PI * 2
        const orbitRadius = 140
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

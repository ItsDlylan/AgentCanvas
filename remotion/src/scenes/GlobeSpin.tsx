import { AbsoluteFill, interpolate, useVideoConfig } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { easeInOut, seeded } from '../math'
import { springAt } from '../kinetic'

interface GlobeSpinProps {
  localFrame: number
  durationInFrames: number
}

/**
 * A wireframe rotating globe with pulsing city markers and arced
 * connections. All geometry computed per-frame via spherical projection
 * (no 3D library — it's just trig). The camera (tiltLat) sweeps slightly
 * over the run, so the sense of orbit is present even though we only
 * rotate longitude.
 */
export const GlobeSpin: React.FC<GlobeSpinProps> = ({ localFrame, durationInFrames }) => {
  const { fps } = useVideoConfig()
  const W = 1280
  const H = 720
  const cx = W / 2
  const cy = H / 2
  const R = 240 // globe radius in px

  // Fade envelope
  const sceneAlpha = interpolate(
    localFrame,
    [0, 10, durationInFrames - 12, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  // Globe longitude rotation — one full spin over 90 frames
  const longitudeDeg = (localFrame / 90) * 360
  const longitude = (longitudeDeg * Math.PI) / 180

  // Camera tilt (latitude). Slight sweep from +12° to -12° to give orbit feel
  const tiltDeg = interpolate(localFrame, [0, durationInFrames], [14, -8], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const tilt = (tiltDeg * Math.PI) / 180
  const sinT = Math.sin(tilt)
  const cosT = Math.cos(tilt)

  // Enter: globe grows from small
  const enter = springAt(localFrame, 0, fps, { damping: 13, stiffness: 100, mass: 0.8 })
  const radius = R * enter

  // Project a (latRad, lonRad) to screen
  function project(
    latRad: number,
    lonRad: number
  ): { x: number; y: number; z: number; visible: boolean } {
    const lonAdj = lonRad + longitude
    let x = Math.cos(latRad) * Math.sin(lonAdj)
    let y = Math.sin(latRad)
    let z = Math.cos(latRad) * Math.cos(lonAdj)
    // Apply latitude tilt (rotate around X axis)
    const yRot = y * cosT - z * sinT
    const zRot = y * sinT + z * cosT
    return {
      x: cx + x * radius,
      y: cy - yRot * radius,
      z: zRot,
      visible: zRot > -0.05
    }
  }

  // Longitude lines (meridians)
  const meridianPaths: string[] = []
  const meridianVisibility: boolean[] = []
  for (let lonDeg = -180; lonDeg < 180; lonDeg += 20) {
    const pts: string[] = []
    let anyVisible = false
    for (let latDeg = -90; latDeg <= 90; latDeg += 4) {
      const p = project((latDeg * Math.PI) / 180, (lonDeg * Math.PI) / 180)
      if (p.visible) {
        anyVisible = true
        pts.push(`${pts.length === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      } else {
        pts.push('M 0 0')
      }
    }
    meridianPaths.push(pts.join(' '))
    meridianVisibility.push(anyVisible)
  }

  // Latitude lines (parallels)
  const parallelPaths: string[] = []
  for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
    const pts: string[] = []
    for (let lonDeg = -180; lonDeg <= 180; lonDeg += 4) {
      const p = project((latDeg * Math.PI) / 180, (lonDeg * Math.PI) / 180)
      if (p.visible) {
        pts.push(`${pts.length === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      } else {
        pts.push('M 0 0')
      }
    }
    parallelPaths.push(pts.join(' '))
  }

  // City markers (lat, lon)
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

  // Connection arcs (random pairs that appear over time)
  const arcPairs: [number, number][] = [
    [0, 2],
    [1, 5],
    [3, 4],
    [6, 0],
    [2, 7]
  ]

  return (
    <AbsoluteFill style={{ background: theme.bg, opacity: sceneAlpha, overflow: 'hidden' }}>
      {/* Background stars */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {Array.from({ length: 120 }, (_, i) => (
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

        {/* Parallels */}
        {parallelPaths.map((d, i) => (
          <path
            key={`par-${i}`}
            d={d}
            stroke={theme.blue}
            strokeOpacity={0.22}
            strokeWidth={1}
            fill="none"
          />
        ))}

        {/* Meridians */}
        {meridianPaths.map((d, i) => (
          <path
            key={`mer-${i}`}
            d={d}
            stroke={theme.blue}
            strokeOpacity={0.22}
            strokeWidth={1}
            fill="none"
          />
        ))}

        {/* Connection arcs */}
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
          const curveHeight = Math.min(dist * 0.45, 140)
          // Push mid-point outward from globe center
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
              {/* Outer pulse */}
              <circle
                cx={c.p.x}
                cy={c.p.y}
                r={9 + pulse * 6}
                fill="none"
                stroke={theme.blue}
                strokeOpacity={0.25}
                strokeWidth={1.5}
              />
              {/* Inner dot */}
              <circle cx={c.p.x} cy={c.p.y} r={3.5} fill="#93c5fd" />
              {/* Label (only for near-side cities, offset) */}
              {c.p.z > 0.4 && (
                <text
                  x={c.p.x + 12}
                  y={c.p.y - 10}
                  fontFamily={monoStack}
                  fontSize={11}
                  fill={theme.text}
                  opacity={0.65}
                >
                  {c.name}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Caption */}
      <Caption localFrame={localFrame} />

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

const Caption: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const fullLine = 'ship where your users are'
  const opacity = interpolate(localFrame, [10, 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const typedLen = Math.max(0, Math.min(fullLine.length, Math.floor((localFrame - 14) * 1.2)))
  const cursorVisible = Math.floor(localFrame / 6) % 2 === 0
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 90,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontFamily: monoStack,
        color: theme.textMuted,
        opacity,
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 5,
          color: theme.textDim,
          marginBottom: 6
        }}
      >
        [ globe ]
      </div>
      <div style={{ fontSize: 22, color: theme.text, fontFamily: fontStack, fontWeight: 500 }}>
        {fullLine.slice(0, typedLen)}
        {typedLen < fullLine.length && cursorVisible ? '▎' : ''}
      </div>
    </div>
  )
}

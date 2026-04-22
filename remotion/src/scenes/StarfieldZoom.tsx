import { AbsoluteFill, interpolate, useVideoConfig } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { easeInOut, easeOutExpo, seeded } from '../math'

interface StarfieldZoomProps {
  localFrame: number
  durationInFrames: number
}

/**
 * Four-phase flight:
 *
 *   A. HYPERSPACE  (0 → ~30f)  — 400 stars streak past on radial vectors.
 *   B. DECEL       (~30 → ~55f) — streaks shorten into point-stars; four
 *                                 workspace folders materialise in 3D depth,
 *                                 labels coming in with per-character springs.
 *   C. APPROACH    (~55 → ~90f) — camera pans to the primary folder; the
 *                                 folder grows, others recede / blur.
 *   D. OPEN        (~90 → end)  — folder "opens" (top flap lifts, fold
 *                                 crease widens) and the workspace tiles
 *                                 inside fly out on a fan layout.
 *
 * No text uses a basic translate-only slide: folder labels use per-char
 * scramble → lock; the lead-in caption uses a draw-on underline + typewriter.
 */
export const StarfieldZoom: React.FC<StarfieldZoomProps> = ({
  localFrame,
  durationInFrames
}) => {
  const { fps } = useVideoConfig()
  const W = 1280
  const H = 720
  const cx = W / 2
  const cy = H / 2

  // Phase markers
  const PHASE_A_END = 30
  const PHASE_B_END = 55
  const PHASE_C_END = 92
  // Phase D runs until durationInFrames - exit

  // Scene envelope
  const sceneAlpha = interpolate(
    localFrame,
    [0, 6, durationInFrames - 10, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  // Hyperspace streak length → 0 as we decelerate
  const streakLenT = interpolate(localFrame, [0, PHASE_A_END, PHASE_B_END], [1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const decelEased = easeOutExpo(streakLenT)

  // Generate stars with seeded angle + base distance
  const stars = Array.from({ length: 380 }, (_, i) => {
    const angle = seeded(i + 1) * Math.PI * 2
    const distPhase = ((seeded(i + 7) + localFrame / 110) % 1)
    // Distance near camera near 0, far at 1
    const d = 1 - distPhase
    // Projected: radius on screen grows as star gets closer
    const r = Math.pow(d, 2.3) * 620
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    // Streak length — long during hyperspace, zero after decel
    const streakLen = decelEased * Math.pow(d, 1.6) * 90
    const tx = cx + Math.cos(angle) * (r - streakLen)
    const ty = cy + Math.sin(angle) * (r - streakLen)
    const brightness = 0.3 + Math.pow(d, 3) * 0.7
    const hueSeed = seeded(i + 23)
    const color =
      hueSeed < 0.7 ? '#ffffff' : hueSeed < 0.9 ? '#93c5fd' : '#a78bfa'
    return { i, x, y, tx, ty, r: 1 + Math.pow(d, 3) * 2.2, color, brightness, d }
  })

  return (
    <AbsoluteFill style={{ background: theme.bg, opacity: sceneAlpha, overflow: 'hidden' }}>
      {/* Stars */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {stars.map((s) =>
          decelEased > 0.05 ? (
            <line
              key={s.i}
              x1={s.tx}
              y1={s.ty}
              x2={s.x}
              y2={s.y}
              stroke={s.color}
              strokeWidth={s.r * 0.6}
              strokeLinecap="round"
              opacity={s.brightness}
            />
          ) : (
            <circle
              key={s.i}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill={s.color}
              opacity={s.brightness}
            />
          )
        )}
      </svg>

      {/* Distant nebula gradient (fades in during decel) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 40% 55%, rgba(99,102,241,0.18), transparent 55%), radial-gradient(circle at 70% 30%, rgba(236,72,153,0.1), transparent 55%)',
          opacity: interpolate(localFrame, [20, 55], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
          })
        }}
      />

      {/* Folders (phase B onward) */}
      <Folders localFrame={localFrame} phaseCEnd={PHASE_C_END} duration={durationInFrames} />

      {/* Mid-phase caption */}
      <Caption localFrame={localFrame} phaseBEnd={PHASE_B_END} />

      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at center, transparent 45%, rgba(9,9,11,0.8) 100%)',
          pointerEvents: 'none'
        }}
      />
    </AbsoluteFill>
  )
}

// ── Folders: 4 workspace cards in 3D depth ──

interface FolderSpec {
  id: string
  label: string
  color: string
  tiles: Array<{ kind: 'terminal' | 'browser' | 'note'; label: string }>
}

const FOLDERS: FolderSpec[] = [
  {
    id: 'ship',
    label: 'Ship',
    color: theme.blue,
    tiles: [
      { kind: 'terminal', label: 'deploy.sh' },
      { kind: 'browser', label: 'vercel.com' },
      { kind: 'note', label: 'release notes' }
    ]
  },
  {
    id: 'research',
    label: 'Research',
    color: theme.purple,
    tiles: [
      { kind: 'browser', label: 'arxiv.org' },
      { kind: 'note', label: 'lit review' }
    ]
  },
  {
    id: 'backend',
    label: 'Backend',
    color: theme.green,
    tiles: [
      { kind: 'terminal', label: 'claude' },
      { kind: 'terminal', label: 'pnpm dev' },
      { kind: 'browser', label: 'localhost' }
    ]
  },
  {
    id: 'design',
    label: 'Design',
    color: theme.orange,
    tiles: [
      { kind: 'browser', label: 'figma.com' },
      { kind: 'note', label: 'mood board' }
    ]
  }
]

const PRIMARY_INDEX = 0 // Ship

const Folders: React.FC<{ localFrame: number; phaseCEnd: number; duration: number }> = ({
  localFrame,
  phaseCEnd,
  duration
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        perspective: '1400px',
        transformStyle: 'preserve-3d',
        pointerEvents: 'none'
      }}
    >
      {FOLDERS.map((folder, i) => (
        <Folder
          key={folder.id}
          folder={folder}
          index={i}
          isPrimary={i === PRIMARY_INDEX}
          localFrame={localFrame}
          phaseCEnd={phaseCEnd}
          totalDuration={duration}
        />
      ))}
    </div>
  )
}

const Folder: React.FC<{
  folder: FolderSpec
  index: number
  isPrimary: boolean
  localFrame: number
  phaseCEnd: number
  totalDuration: number
}> = ({ folder, index, isPrimary, localFrame, phaseCEnd, totalDuration }) => {
  // Appearance timing: stagger appearance in phase B
  const appearAt = 34 + index * 4
  const t = interpolate(localFrame, [appearAt, appearAt + 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  if (t <= 0) return null

  // Folder positions in the world (radial arrangement around center)
  // Non-primary folders drift off-screen in phase C
  const radial = [
    { x: 0, y: 0, z: 0 }, // primary — center
    { x: 340, y: -180, z: -200 },
    { x: -360, y: -140, z: -260 },
    { x: 260, y: 200, z: -300 }
  ]
  const slot = radial[index] ?? { x: 0, y: 0, z: 0 }

  // Phase C: primary approaches (z moves forward), others recede
  const approachT = interpolate(localFrame, [phaseCEnd - 38, phaseCEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const approachEased = easeInOut(approachT)

  // Approach transforms
  let tx = slot.x
  let ty = slot.y
  let tz = slot.z
  let scale = 1

  if (isPrimary) {
    // Pull forward, grow
    tz = slot.z + approachEased * 420
    scale = 1 + approachEased * 0.55
    // Drift toward center slightly
    tx = slot.x * (1 - approachEased)
    ty = slot.y * (1 - approachEased)
  } else {
    // Fly past the camera
    tz = slot.z - approachEased * 800
    tx = slot.x * (1 + approachEased * 1.5)
    ty = slot.y * (1 + approachEased * 1.5)
    scale = 1 - approachEased * 0.5
  }

  // Phase D: primary folder opens and contents fly out
  const openT = interpolate(localFrame, [phaseCEnd, phaseCEnd + 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const isOpening = isPrimary && openT > 0

  // Phase D: zoom camera all the way in — primary grows to fill, then fades
  const diveT = interpolate(
    localFrame,
    [phaseCEnd + 10, totalDuration - 10],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
  const diveEased = easeInOut(diveT)
  const diveScale = isPrimary ? 1 + diveEased * 3.2 : 1
  const diveOpacity = isPrimary ? 1 - Math.pow(diveEased, 2) : 1

  const opacity = t * (isPrimary ? diveOpacity : 1 - approachEased * 0.9)

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: `translate3d(${tx - 170}px, ${ty - 120}px, ${tz}px) scale(${scale * diveScale})`,
        transformStyle: 'preserve-3d',
        opacity,
        filter: isPrimary ? 'none' : `blur(${approachEased * 4}px)`,
        willChange: 'transform, opacity'
      }}
    >
      <FolderCard folder={folder} localFrame={localFrame} openT={openT} isPrimary={isPrimary} />
      {isOpening && (
        <WorkspaceTiles
          folder={folder}
          localFrame={localFrame}
          openT={openT}
          phaseCEnd={phaseCEnd}
        />
      )}
    </div>
  )
}

// ── Folder card visual ──
const FolderCard: React.FC<{
  folder: FolderSpec
  localFrame: number
  openT: number
  isPrimary: boolean
}> = ({ folder, localFrame, openT, isPrimary }) => {
  // The folder is a 340x240 stylised folder with a tab and body.
  // On open: tab lifts (rotateX), body crease brightens.
  const tabLift = openT * -60 // rotateX degrees
  const tabShift = openT * -24 // translateY

  // Folder count badge (shows tile count)
  const count = folder.tiles.length

  return (
    <div
      style={{
        width: 340,
        height: 240,
        position: 'relative',
        transformStyle: 'preserve-3d',
        fontFamily: fontStack
      }}
    >
      {/* Folder body */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 14,
          background: `linear-gradient(160deg, ${folder.color}22 0%, ${theme.panel} 60%, ${theme.bg} 100%)`,
          border: `1px solid ${folder.color}66`,
          boxShadow: isPrimary
            ? `0 30px 80px ${folder.color}33, 0 0 0 1px ${folder.color}22`
            : `0 12px 30px rgba(0,0,0,0.5)`,
          overflow: 'hidden'
        }}
      >
        {/* Dot grid inside the folder body */}
        <DotGridInside color={folder.color} />

        {/* Mini preview of tiles inside (faded) */}
        <div
          style={{
            position: 'absolute',
            inset: 24,
            top: 44,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
            opacity: 0.45
          }}
        >
          {folder.tiles.map((t, i) => (
            <div
              key={i}
              style={{
                height: 54,
                borderRadius: 6,
                background: t.kind === 'terminal' ? '#0d0e12' : t.kind === 'browser' ? '#10131a' : '#1a1410',
                border: `1px solid ${folder.color}44`,
                padding: 6,
                display: 'flex',
                alignItems: 'center',
                fontFamily: monoStack,
                fontSize: 9,
                color: theme.textMuted,
                gap: 4
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: folder.color,
                  flexShrink: 0
                }}
              />
              {t.label}
            </div>
          ))}
        </div>

        {/* Label (bottom bar) + count pill */}
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 14,
            right: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: theme.text
          }}
        >
          <FolderLabel text={folder.label} color={folder.color} localFrame={localFrame} />
          <span
            style={{
              fontFamily: monoStack,
              fontSize: 12,
              color: folder.color,
              padding: '3px 8px',
              borderRadius: 999,
              border: `1px solid ${folder.color}55`
            }}
          >
            {count} tiles
          </span>
        </div>
      </div>

      {/* Folder tab (top-left) — lifts on open */}
      <div
        style={{
          position: 'absolute',
          top: -14,
          left: 20,
          width: 130,
          height: 28,
          borderRadius: '8px 16px 0 0',
          background: folder.color,
          transformOrigin: 'center bottom',
          transform: `translateY(${tabShift}px) rotateX(${tabLift}deg)`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          fontFamily: monoStack,
          fontSize: 11,
          fontWeight: 600,
          color: '#000',
          letterSpacing: 0.5,
          textTransform: 'uppercase'
        }}
      >
        workspace
      </div>
    </div>
  )
}

// Folder label: character-scramble into final text
const FolderLabel: React.FC<{
  text: string
  color: string
  localFrame: number
}> = ({ text, color, localFrame }) => {
  // Scramble pool local so we don't import
  const chars = text.split('')
  return (
    <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5 }}>
      {chars.map((ch, i) => {
        const startF = 36 + i * 1.5
        const endF = startF + 10
        if (localFrame < startF) return null
        if (localFrame >= endF) {
          return (
            <span key={i} style={{ color: theme.text }}>
              {ch}
            </span>
          )
        }
        const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#$@%&*!'
        const idx = Math.floor(
          ((localFrame * 9973) ^ (i * 51)) % pool.length
        )
        return (
          <span key={i} style={{ color }}>
            {pool[Math.abs(idx) % pool.length]}
          </span>
        )
      })}
    </span>
  )
}

// Dot grid inside folder body (canvas-like)
const DotGridInside: React.FC<{ color: string }> = ({ color }) => {
  const dots: React.ReactNode[] = []
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 14; x++) {
      dots.push(
        <circle
          key={`${x}-${y}`}
          cx={16 + x * 24}
          cy={40 + y * 20}
          r={1}
          fill={color}
          opacity={0.18}
        />
      )
    }
  }
  return (
    <svg
      width={340}
      height={240}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {dots}
    </svg>
  )
}

// ── Workspace tiles that fly out when the folder opens ──
const WorkspaceTiles: React.FC<{
  folder: FolderSpec
  localFrame: number
  openT: number
  phaseCEnd: number
}> = ({ folder, localFrame, phaseCEnd }) => {
  // 3 tiles fan out above the folder
  const positions: Array<{ x: number; y: number; rot: number }> = [
    { x: -220, y: -220, rot: -8 },
    { x: 0, y: -300, rot: 2 },
    { x: 220, y: -220, rot: 8 }
  ]
  return (
    <>
      {folder.tiles.slice(0, 3).map((tile, i) => {
        const startF = phaseCEnd + 4 + i * 3
        const t = interpolate(localFrame, [startF, startF + 20], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp'
        })
        const eased = easeOutExpo(t)
        const pos = positions[i] ?? positions[0]
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 170,
              top: 120,
              width: 130,
              height: 90,
              transform: `translate(${-65 + pos.x * eased}px, ${-45 + pos.y * eased}px) rotate(${pos.rot * eased}deg) scale(${0.6 + eased * 0.5})`,
              borderRadius: 10,
              background: theme.panel,
              border: `1px solid ${folder.color}88`,
              boxShadow: `0 12px 30px ${folder.color}44`,
              opacity: t,
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontFamily: monoStack
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
                color: theme.textMuted
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: folder.color
                }}
              />
              {tile.kind}
            </div>
            <div
              style={{
                fontSize: 12,
                color: theme.text,
                fontWeight: 600
              }}
            >
              {tile.label}
            </div>
            <div
              style={{
                flex: 1,
                borderRadius: 4,
                background: '#0c0d12',
                marginTop: 2
              }}
            />
          </div>
        )
      })}
    </>
  )
}

// ── Mid-phase caption (below stars, above folders) ──
const Caption: React.FC<{ localFrame: number; phaseBEnd: number }> = ({
  localFrame,
  phaseBEnd
}) => {
  const textStart = phaseBEnd - 14
  const textEnd = phaseBEnd + 20
  const opacity = interpolate(
    localFrame,
    [textStart, textStart + 10, textEnd, textEnd + 10],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
  if (opacity <= 0) return null

  const line = 'entering workspace…'
  const charsShown = Math.max(
    0,
    Math.min(line.length, Math.floor((localFrame - textStart) * 1.4))
  )
  const cursorVisible = Math.floor(localFrame / 6) % 2 === 0
  const underlineDraw = interpolate(
    localFrame,
    [textStart + 6, textStart + 18],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  return (
    <div
      style={{
        position: 'absolute',
        top: 70,
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
          marginBottom: 4
        }}
      >
        [ canvas ]
      </div>
      <div style={{ fontSize: 18, display: 'inline-block' }}>
        {line.slice(0, charsShown)}
        {charsShown < line.length && cursorVisible ? '▎' : ''}
      </div>
      <div
        style={{
          width: `${underlineDraw * 220}px`,
          height: 1,
          background: theme.blue,
          margin: '8px auto 0',
          boxShadow: `0 0 8px ${theme.blue}`
        }}
      />
    </div>
  )
}

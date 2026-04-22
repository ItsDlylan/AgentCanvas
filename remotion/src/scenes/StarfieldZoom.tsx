import { AbsoluteFill, interpolate, useVideoConfig } from 'remotion'
import { useCurrentFrame } from 'remotion'
import { fontStack, monoStack, theme } from '../theme'
import { easeInOut, easeOutExpo, seeded } from '../math'

interface StarfieldZoomProps {
  localFrame: number
  durationInFrames: number
}

/**
 * Six-phase flight:
 *
 *   A. HYPERSPACE      (0 → 30f)   — 380 star streaks decelerating.
 *   B. REVEAL          (30 → 58f)  — four labelled workspace folders
 *                                    materialise in 3D space around the
 *                                    viewer: Frontend (left-near),
 *                                    Backend (right-near), Mobile App
 *                                    (left-far), Laravel New (right-far).
 *   C. ORBIT GLIDE     (58 → 140f) — camera pans through 3D space like a
 *                                    user panning the AgentCanvas itself,
 *                                    sweeping past each folder. No scale-
 *                                    and-fade — real parallax.
 *   D. COMMIT          (140 → 160f) — camera settles centred on Frontend.
 *   E. FOLDER OPENS    (160 → 185f) — tab lifts (rotateX), body expands,
 *                                     tile previews scale up into full
 *                                     inline tiles (terminal typing,
 *                                     browser URL, note, task).
 *   F. DIVE            (185 → end)  — camera passes through the folder
 *                                     face; interior fills the frame and
 *                                     hands off to CanvasDive.
 *
 * The Frontend folder's tiles are the *exact* same four tiles that
 * appear in CanvasDive, so scene 4 reads as "we entered this workspace."
 */

// ── World coordinates (in px, with a perspective of 1600) ──
// Positive Z = farther away from camera. Camera lives at origin looking
// down -Z. World transform is inverse of camera position.
interface CameraPose {
  x: number
  y: number
  z: number
  rotY: number
  rotX: number
}

// Camera keyframes (frames relative to scene start)
const CAM_FRAMES = [0, 30, 58, 85, 112, 140, 160, 185, 200] as const
const CAM_POSES: CameraPose[] = [
  { x: 0, y: 0, z: -1200, rotY: 0, rotX: 0 }, // hyperspace pull-back
  { x: 0, y: 0, z: -900, rotY: 0, rotX: 0 }, // settle at wide establishing
  { x: 0, y: 0, z: -750, rotY: 0, rotX: 2 }, // folders visible
  { x: 260, y: -60, z: -650, rotY: -12, rotX: 4 }, // glide right, parallax reveal
  { x: -220, y: 40, z: -700, rotY: 9, rotX: -2 }, // glide left
  { x: -60, y: 0, z: -600, rotY: 3, rotX: 0 }, // returning
  { x: -380, y: -80, z: -380, rotY: 2, rotX: 0 }, // centring on Frontend (at -400, -100, -300)
  { x: -400, y: -100, z: -220, rotY: 0, rotX: 0 }, // very close to Frontend face
  { x: -400, y: -100, z: 120, rotY: 0, rotX: 0 } // INSIDE Frontend — past its Z
]

function camAt(localFrame: number): CameraPose {
  // Find the two keyframes bracketing localFrame
  for (let i = 0; i < CAM_FRAMES.length - 1; i++) {
    if (localFrame >= CAM_FRAMES[i] && localFrame <= CAM_FRAMES[i + 1]) {
      const t = interpolate(
        localFrame,
        [CAM_FRAMES[i], CAM_FRAMES[i + 1]],
        [0, 1]
      )
      const eased = easeInOut(t)
      const a = CAM_POSES[i]
      const b = CAM_POSES[i + 1]
      return {
        x: a.x + (b.x - a.x) * eased,
        y: a.y + (b.y - a.y) * eased,
        z: a.z + (b.z - a.z) * eased,
        rotY: a.rotY + (b.rotY - a.rotY) * eased,
        rotX: a.rotX + (b.rotX - a.rotX) * eased
      }
    }
  }
  return CAM_POSES[CAM_POSES.length - 1]
}

// ── Folder positions in world space ──
interface WorldFolder {
  id: string
  name: string
  color: string
  worldX: number
  worldY: number
  worldZ: number
  rotY: number
  isChosen: boolean
  tiles: MiniTile[]
}

interface MiniTile {
  kind: 'terminal' | 'browser' | 'note' | 'task'
  accent: string
}

// Tiles for the chosen "Frontend" folder — match CanvasDive exactly.
const FRONTEND_TILES: MiniTile[] = [
  { kind: 'terminal', accent: theme.green },
  { kind: 'browser', accent: theme.blue },
  { kind: 'note', accent: theme.orange },
  { kind: 'task', accent: theme.purple }
]

const FOLDERS: WorldFolder[] = [
  {
    id: 'frontend',
    name: 'Frontend',
    color: theme.blue,
    worldX: -400,
    worldY: -100,
    worldZ: -300,
    rotY: 8,
    isChosen: true,
    tiles: FRONTEND_TILES
  },
  {
    id: 'backend',
    name: 'Backend',
    color: theme.green,
    worldX: 380,
    worldY: -120,
    worldZ: -220,
    rotY: -10,
    isChosen: false,
    tiles: [
      { kind: 'terminal', accent: theme.green },
      { kind: 'terminal', accent: theme.green },
      { kind: 'browser', accent: theme.blue }
    ]
  },
  {
    id: 'mobile',
    name: 'Mobile App',
    color: theme.pink,
    worldX: -340,
    worldY: 180,
    worldZ: -80,
    rotY: 6,
    isChosen: false,
    tiles: [
      { kind: 'terminal', accent: theme.green },
      { kind: 'browser', accent: theme.pink },
      { kind: 'note', accent: theme.orange }
    ]
  },
  {
    id: 'laravel',
    name: 'Laravel New',
    color: theme.orange,
    worldX: 420,
    worldY: 160,
    worldZ: -120,
    rotY: -8,
    isChosen: false,
    tiles: [
      { kind: 'terminal', accent: theme.green },
      { kind: 'browser', accent: theme.blue },
      { kind: 'note', accent: theme.orange },
      { kind: 'task', accent: theme.purple }
    ]
  }
]

export const StarfieldZoom: React.FC<StarfieldZoomProps> = ({
  localFrame,
  durationInFrames
}) => {
  const W = 1280
  const H = 720

  const sceneAlpha = interpolate(
    localFrame,
    [0, 6, durationInFrames - 8, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  // Camera pose
  const cam = camAt(localFrame)

  // Hyperspace streak length decays → 0 after frame 30
  const streakLenT = interpolate(localFrame, [0, 28, 42], [1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const streak = easeOutExpo(streakLenT)

  // Nebula fades in as we decelerate
  const nebulaAlpha = interpolate(localFrame, [22, 55], [0, 0.9], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })

  // Frontend "opens" interpolation
  const openT = interpolate(localFrame, [158, 186], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  // Chosen folder's preview transitions to full tiles 180→195
  const expandT = interpolate(localFrame, [178, 196], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        opacity: sceneAlpha,
        overflow: 'hidden',
        perspective: '1600px'
      }}
    >
      {/* Starfield (screen-space — stars don't inherit the camera transform) */}
      <Hyperspace streak={streak} width={W} height={H} localFrame={localFrame} />

      {/* Nebula gradient */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 40% 55%, rgba(99,102,241,0.22), transparent 55%), radial-gradient(circle at 70% 30%, rgba(236,72,153,0.12), transparent 55%)',
          opacity: nebulaAlpha
        }}
      />

      {/* 3D world */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformStyle: 'preserve-3d',
          transform: `translate3d(${-cam.x}px, ${-cam.y}px, ${-cam.z}px) rotateY(${-cam.rotY}deg) rotateX(${-cam.rotX}deg)`,
          willChange: 'transform'
        }}
      >
        {/* World floor dots — infinite canvas feel */}
        <WorldGrid />

        {/* Folders */}
        {FOLDERS.map((f, i) => (
          <Folder3D
            key={f.id}
            folder={f}
            appearAt={34 + i * 3}
            openT={f.isChosen ? openT : 0}
            expandT={f.isChosen ? expandT : 0}
            localFrame={localFrame}
          />
        ))}
      </div>

      {/* Light vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at center, transparent 55%, rgba(9,9,11,0.7) 100%)',
          pointerEvents: 'none'
        }}
      />

      {/* HUD caption — "entering: Frontend" once we commit */}
      <HUD localFrame={localFrame} />
    </AbsoluteFill>
  )
}

// ── Hyperspace ──
const Hyperspace: React.FC<{
  streak: number
  width: number
  height: number
  localFrame: number
}> = ({ streak, width, height, localFrame }) => {
  const cx = width / 2
  const cy = height / 2
  const stars = Array.from({ length: 360 }, (_, i) => {
    const angle = seeded(i + 1) * Math.PI * 2
    const distPhase = (seeded(i + 7) + localFrame / 95) % 1
    const d = 1 - distPhase
    const r = Math.pow(d, 2.3) * 680
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    const streakLen = streak * Math.pow(d, 1.6) * 95
    const tx = cx + Math.cos(angle) * (r - streakLen)
    const ty = cy + Math.sin(angle) * (r - streakLen)
    const brightness = 0.3 + Math.pow(d, 3) * 0.7
    const hueSeed = seeded(i + 23)
    const color =
      hueSeed < 0.7 ? '#ffffff' : hueSeed < 0.9 ? '#93c5fd' : '#a78bfa'
    return { i, x, y, tx, ty, r: 0.9 + Math.pow(d, 3) * 2.1, color, brightness }
  })
  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
      {stars.map((s) =>
        streak > 0.04 ? (
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
          <circle key={s.i} cx={s.x} cy={s.y} r={s.r} fill={s.color} opacity={s.brightness} />
        )
      )}
    </svg>
  )
}

// ── World grid (dot plane below folders) ──
const WorldGrid: React.FC = () => {
  const dots: React.ReactNode[] = []
  for (let ix = -10; ix <= 10; ix++) {
    for (let iz = -6; iz <= 6; iz++) {
      const wx = ix * 120
      const wz = iz * 120 - 300
      dots.push(
        <div
          key={`${ix}-${iz}`}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 2,
            height: 2,
            borderRadius: 999,
            background: '#2a2a35',
            transform: `translate3d(${wx - 1}px, 280px, ${wz}px)`
          }}
        />
      )
    }
  }
  return <>{dots}</>
}

// ── 3D folder in world space ──
const Folder3D: React.FC<{
  folder: WorldFolder
  appearAt: number
  openT: number
  expandT: number
  localFrame: number
}> = ({ folder, appearAt, openT, expandT, localFrame }) => {
  const appear = interpolate(localFrame, [appearAt, appearAt + 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  if (appear <= 0) return null

  // Folder "grows" its native size as it opens (chosen only)
  const openScale = 1 + openT * 0.45
  // Chosen folder fades when we're inside it
  const insideFade = expandT > 0.9 ? 1 - (expandT - 0.9) / 0.1 : 1

  const W_FOLDER = 420
  const H_FOLDER = 300

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: W_FOLDER,
        height: H_FOLDER,
        marginLeft: -W_FOLDER / 2,
        marginTop: -H_FOLDER / 2,
        transformStyle: 'preserve-3d',
        transform: `translate3d(${folder.worldX}px, ${folder.worldY}px, ${folder.worldZ}px) rotateY(${folder.rotY}deg) scale(${openScale})`,
        opacity: appear * insideFade,
        willChange: 'transform'
      }}
    >
      <FolderFace folder={folder} openT={openT} expandT={expandT} localFrame={localFrame} />
    </div>
  )
}

// ── Folder face: tab + body + tiles ──
const FolderFace: React.FC<{
  folder: WorldFolder
  openT: number
  expandT: number
  localFrame: number
}> = ({ folder, openT, expandT, localFrame }) => {
  const tabTilt = openT * -72 // tab lifts away
  const tabShift = openT * -18

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
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
          boxShadow: folder.isChosen
            ? `0 30px 80px ${folder.color}33, 0 0 0 1px ${folder.color}22`
            : `0 12px 30px rgba(0,0,0,0.5)`,
          overflow: 'hidden'
        }}
      >
        {/* Dot grid canvas background */}
        <DotGridInside color={folder.color} w={420} h={300} />

        {/* Tile preview grid (folded inside) */}
        <div
          style={{
            position: 'absolute',
            inset: 16,
            top: 40,
            bottom: 16,
            display: 'grid',
            gridTemplateColumns: folder.tiles.length >= 4 ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gridTemplateRows: folder.tiles.length >= 4 ? 'repeat(2, 1fr)' : 'auto',
            gap: 8,
            opacity: 1 - expandT * 0.3
          }}
        >
          {folder.tiles.slice(0, 4).map((tile, i) => (
            <MiniTileBody key={i} tile={tile} folder={folder} index={i} localFrame={localFrame} />
          ))}
        </div>

        {/* Count pill */}
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            fontFamily: monoStack,
            fontSize: 11,
            color: folder.color,
            padding: '3px 8px',
            borderRadius: 999,
            border: `1px solid ${folder.color}55`,
            background: 'rgba(0,0,0,0.5)'
          }}
        >
          {folder.tiles.length} tiles
        </div>
      </div>

      {/* Folder tab — shows workspace name */}
      <div
        style={{
          position: 'absolute',
          top: -18,
          left: 24,
          height: 32,
          padding: '0 16px',
          borderRadius: '10px 18px 0 0',
          background: folder.color,
          color: '#0a0a0a',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: fontStack,
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: 0.2,
          transformOrigin: 'center bottom',
          transform: `translateY(${tabShift}px) rotateX(${tabTilt}deg)`,
          boxShadow: `0 0 20px ${folder.color}44`
        }}
      >
        <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor" aria-hidden>
          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
        </svg>
        {folder.name}
      </div>
    </div>
  )
}

// ── A mini-tile inside a folder — renders like a real AgentCanvas tile ──
const MiniTileBody: React.FC<{
  tile: MiniTile
  folder: WorldFolder
  index: number
  localFrame: number
}> = ({ tile, folder, index, localFrame }) => {
  // Stagger the "alive" animation for tiles inside the chosen folder.
  const aliveAt = folder.isChosen ? 60 + index * 4 : 70 + index * 6
  const alive = Math.max(0, localFrame - aliveAt)

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 6,
        background: '#0c0d12',
        border: `1px solid ${folder.color}44`,
        padding: 6,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontFamily: monoStack,
        fontSize: 8
      }}
    >
      {/* Mini tile header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 7,
          color: theme.textMuted
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: tile.accent
          }}
        />
        {tile.kind}
      </div>
      {/* Mini tile content based on kind */}
      <div style={{ flex: 1, overflow: 'hidden', color: theme.text }}>
        {tile.kind === 'terminal' && <MiniTerminal alive={alive} />}
        {tile.kind === 'browser' && <MiniBrowser alive={alive} />}
        {tile.kind === 'note' && <MiniNote alive={alive} accent={tile.accent} />}
        {tile.kind === 'task' && <MiniTask alive={alive} accent={tile.accent} />}
      </div>
    </div>
  )
}

const MiniTerminal: React.FC<{ alive: number }> = ({ alive }) => {
  const lines = [
    { at: 0, text: '$ claude', color: '#fff' },
    { at: 14, text: '● spawning…', color: '#fbbf24' },
    { at: 26, text: '├ reviewer', color: '#71717a' },
    { at: 32, text: '├ tester', color: '#71717a' },
    { at: 40, text: '✓ ready', color: '#22c55e' }
  ]
  return (
    <div style={{ fontSize: 7, lineHeight: 1.4 }}>
      {lines.map((l, i) => {
        if (alive < l.at) return null
        const chars = Math.min(l.text.length, Math.floor((alive - l.at) * 2))
        return (
          <div key={i} style={{ color: l.color }}>
            {l.text.slice(0, chars)}
          </div>
        )
      })}
    </div>
  )
}

const MiniBrowser: React.FC<{ alive: number }> = ({ alive }) => {
  const url = 'claude.ai/agentcanvas'
  const typed = Math.min(url.length, Math.floor(alive * 1.2))
  const load = Math.min(1, Math.max(0, (alive - 20) / 18))
  return (
    <div style={{ fontSize: 7, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div
        style={{
          padding: '2px 4px',
          background: '#06070a',
          border: '1px solid #1a1b22',
          borderRadius: 3,
          color: '#a1a1aa'
        }}
      >
        {url.slice(0, typed)}
      </div>
      <div
        style={{
          height: 1,
          background: '#1a1b22',
          borderRadius: 1,
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            width: `${load * 100}%`,
            height: '100%',
            background: theme.blue,
            boxShadow: `0 0 3px ${theme.blue}`
          }}
        />
      </div>
      {/* skeleton */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: Math.max(0, (alive - 30) / 10) }}>
        <div style={{ height: 3, width: '70%', background: '#202128' }} />
        <div style={{ height: 8, background: '#1b1c22' }} />
        <div style={{ height: 3, width: '90%', background: '#1a1b21' }} />
      </div>
    </div>
  )
}

const MiniNote: React.FC<{ alive: number; accent: string }> = ({ alive, accent }) => {
  const title = '# Tutorials plan'
  const lines = [
    { at: 10, text: '- Ship welcome' },
    { at: 22, text: '- Record term' },
    { at: 34, text: '- Record brwsr' }
  ]
  const titleChars = Math.min(title.length, Math.floor(alive * 1.2))
  return (
    <div style={{ fontSize: 7, lineHeight: 1.4 }}>
      <div style={{ color: accent }}>{title.slice(0, titleChars)}</div>
      {lines.map((l, i) => {
        if (alive < l.at) return null
        const c = Math.min(l.text.length, Math.floor((alive - l.at) * 1.4))
        return (
          <div key={i} style={{ color: theme.textMuted }}>
            {l.text.slice(0, c)}
          </div>
        )
      })}
    </div>
  )
}

const MiniTask: React.FC<{ alive: number; accent: string }> = ({ alive, accent }) => {
  const tasks = [
    { label: 'Classify', at: 12 },
    { label: 'Link plan', at: 26 },
    { label: 'Review', at: 40 }
  ]
  return (
    <div style={{ fontSize: 7, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {tasks.map((t, i) => {
        const checked = alive >= t.at
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: 2,
                border: `1px solid ${checked ? accent : '#3f3f46'}`,
                background: checked ? accent : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 5,
                lineHeight: 1
              }}
            >
              {checked ? '✓' : ''}
            </div>
            <span
              style={{
                color: checked ? '#52525b' : theme.text,
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

const DotGridInside: React.FC<{ color: string; w: number; h: number }> = ({
  color,
  w,
  h
}) => {
  const dots: React.ReactNode[] = []
  const spacing = 24
  const cols = Math.floor(w / spacing)
  const rows = Math.floor(h / spacing)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      dots.push(
        <circle
          key={`${x}-${y}`}
          cx={16 + x * spacing}
          cy={40 + y * spacing}
          r={1}
          fill={color}
          opacity={0.15}
        />
      )
    }
  }
  return (
    <svg
      width={w}
      height={h}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {dots}
    </svg>
  )
}

// ── HUD caption: "entering Frontend" once we commit ──
const HUD: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const glideOpacity = interpolate(localFrame, [60, 75, 132, 142], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const enteringOpacity = interpolate(
    localFrame,
    [142, 152, 190, 200],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  return (
    <>
      {glideOpacity > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontFamily: monoStack,
            color: theme.textMuted,
            opacity: glideOpacity,
            pointerEvents: 'none'
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: 5,
              color: theme.textDim
            }}
          >
            [ your workspaces ]
          </div>
        </div>
      )}
      {enteringOpacity > 0 && (
        <EnteringHud opacity={enteringOpacity} localFrame={localFrame} />
      )}
    </>
  )
}

const EnteringHud: React.FC<{ opacity: number; localFrame: number }> = ({
  opacity,
  localFrame
}) => {
  const line = 'entering'
  const folder = 'Frontend'
  const typedLine = Math.max(0, Math.min(line.length, Math.floor((localFrame - 144) * 1.4)))
  const typedFolder = Math.max(0, Math.min(folder.length, Math.floor((localFrame - 156) * 1.4)))
  const cursorVisible = Math.floor(localFrame / 6) % 2 === 0
  const underlineDraw = interpolate(
    localFrame,
    [150, 172],
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
        color: theme.text,
        opacity,
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 5,
          color: theme.textDim,
          marginBottom: 4
        }}
      >
        [ workspace ]
      </div>
      <div style={{ fontSize: 20, display: 'inline-block' }}>
        <span style={{ color: theme.textMuted }}>{line.slice(0, typedLine)} </span>
        <span style={{ color: theme.blue, fontWeight: 700 }}>
          {folder.slice(0, typedFolder)}
        </span>
        {typedFolder < folder.length && cursorVisible ? (
          <span style={{ color: theme.blue }}>▎</span>
        ) : null}
      </div>
      <div
        style={{
          width: `${underlineDraw * 240}px`,
          height: 1,
          background: theme.blue,
          margin: '8px auto 0',
          boxShadow: `0 0 8px ${theme.blue}`
        }}
      />
    </div>
  )
}

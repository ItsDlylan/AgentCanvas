import { seeded } from '../math'

interface MatrixRainProps {
  width: number
  height: number
  localFrame: number
  fps: number
  opacity?: number
}

/**
 * Deterministic port of AgentCanvas's matrix-rain background
 * (src/renderer/components/backgrounds/matrix.ts) to Remotion.
 *
 * The runtime version uses Math.random() + mutable per-column state and
 * draws on <canvas>. Remotion renders each frame independently, so we
 * recompute every column's position and character set purely from the
 * current frame, seeded per-column for stable identities.
 *
 * Alphas match the app (very dim teal-green) so the effect reads as
 * atmosphere behind the canvas tiles, not as foreground content.
 */

const CHAR_POOL: string[] = []
for (let i = 0x30a0; i <= 0x30ff; i++) CHAR_POOL.push(String.fromCharCode(i))
for (let i = 65; i <= 90; i++) CHAR_POOL.push(String.fromCharCode(i))
for (let i = 48; i <= 57; i++) CHAR_POOL.push(String.fromCharCode(i))

const FONT_SIZE = 14
const COL_COUNT_TARGET = 50
const SWAP_FRAMES = 15 // how often a column rotates one of its chars

export const MatrixRain: React.FC<MatrixRainProps> = ({
  width,
  height,
  localFrame,
  fps,
  opacity = 1
}) => {
  const colSpacing = Math.max(FONT_SIZE, width / COL_COUNT_TARGET)
  const numCols = Math.ceil(width / colSpacing)
  const maxTrail = Math.ceil(height / FONT_SIZE) + 4
  const timeSec = localFrame / fps

  const nodes: React.ReactNode[] = []

  for (let c = 0; c < numCols; c++) {
    const x = c * colSpacing + colSpacing * 0.5
    const speed = 30 + seeded(c + 1) * 50 // 30–80 px/s
    const length = 8 + Math.floor(seeded(c + 7) * (maxTrail - 8))
    const startOffset = -seeded(c + 13) * height * 1.5
    // Head y position — wraps around like the original implementation
    const period = height + length * FONT_SIZE
    const raw = speed * timeSec + startOffset + period * 4 // +4 periods to keep modulo positive
    const y = (raw % period) - length * FONT_SIZE

    for (let i = 0; i < length; i++) {
      const cy = y + i * FONT_SIZE
      if (cy < -FONT_SIZE || cy > height) continue

      // Character with slow deterministic rotation
      const swapBucket = Math.floor((localFrame + c * 7 + i * 3) / SWAP_FRAMES)
      const charIdx = Math.floor(
        seeded(c * 1000 + i * 37 + swapBucket * 13) * CHAR_POOL.length
      )
      const ch = CHAR_POOL[charIdx]

      const isHead = i === length - 1
      const fade = i / length

      const alpha = isHead ? 0.6 * fade : 0.1 + 0.22 * fade
      const color = isHead
        ? `rgba(80, 220, 100, ${alpha})`
        : `rgba(22, 120, 40, ${alpha})`

      nodes.push(
        <text
          key={`${c}-${i}`}
          x={x}
          y={cy + FONT_SIZE * 0.85}
          fontSize={FONT_SIZE}
          fontFamily="'Courier New', Courier, monospace"
          fill={color}
          textAnchor="middle"
        >
          {ch}
        </text>
      )
    }
  }

  return (
    <svg
      width={width}
      height={height}
      style={{ position: 'absolute', inset: 0, opacity, pointerEvents: 'none' }}
    >
      {nodes}
    </svg>
  )
}

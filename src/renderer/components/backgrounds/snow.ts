import type { BackgroundRenderer } from './types'

const FLAKE_CHARS = ['*', '·', '.', '❄', '✦', '°']
const FONT_SIZE = 14

// Depth layers: 0 = far (small, slow, dim), 2 = close (larger, faster, brighter)
const DEPTH_CONFIG = [
  { fontSize: 10, speedMin: 15, speedMax: 25,  driftAmp: 20, color: '#1a1a1f' }, // far
  { fontSize: 12, speedMin: 28, speedMax: 42,  driftAmp: 30, color: '#222228' }, // mid
  { fontSize: 14, speedMin: 45, speedMax: 65,  driftAmp: 40, color: '#2a2a30' }, // close
]

interface Snowflake {
  x: number            // horizontal position (px)
  startY: number       // starting Y offset for staggering
  fallSpeed: number    // vertical speed (px/s)
  driftPhase: number   // phase offset for horizontal sine drift
  driftFreq: number    // drift frequency (how fast it sways)
  driftAmp: number     // amplitude of horizontal sway (px)
  depth: number        // 0, 1, or 2
  charIndex: number    // index into FLAKE_CHARS
}

interface SnowState {
  flakes: Snowflake[]
}

function initState(width: number, height: number): SnowState {
  const totalFlakes = 90
  const flakes: Snowflake[] = new Array(totalFlakes)

  for (let i = 0; i < totalFlakes; i++) {
    // Distribute across depth layers: more far, fewer close
    const depth = i < 35 ? 0 : i < 65 ? 1 : 2
    const cfg = DEPTH_CONFIG[depth]

    // Far flakes use smaller/simpler chars, close flakes use all chars
    let charIndex: number
    if (depth === 0) {
      // far: mostly dots and small chars
      charIndex = [1, 2, 5][(Math.random() * 3) | 0]
    } else if (depth === 1) {
      // mid: medium variety
      charIndex = [0, 1, 2, 5][(Math.random() * 4) | 0]
    } else {
      // close: full variety
      charIndex = (Math.random() * FLAKE_CHARS.length) | 0
    }

    flakes[i] = {
      x: Math.random() * width,
      startY: -Math.random() * height * 2, // stagger starts above viewport
      fallSpeed: cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin),
      driftPhase: Math.random() * Math.PI * 2,
      driftFreq: 0.3 + Math.random() * 0.5,
      driftAmp: cfg.driftAmp * (0.5 + Math.random() * 0.5),
      depth,
      charIndex,
    }
  }

  return { flakes }
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: unknown,
): void {
  const s = state as SnowState

  ctx.clearRect(0, 0, width, height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const timeSec = time / 1000

  // Track current depth so we batch font/color changes
  let currentDepth = -1

  for (let i = 0; i < s.flakes.length; i++) {
    const flake = s.flakes[i]

    // Calculate vertical position with wrapping
    const totalDrop = flake.fallSpeed * timeSec + flake.startY
    // Wrap around: when flake goes below screen, reset to top
    const wrapHeight = height + 40 // extra padding so flake fully exits
    let y = ((totalDrop % wrapHeight) + wrapHeight) % wrapHeight - 20

    // Horizontal drift — gentle sine sway
    const driftX = Math.sin(timeSec * flake.driftFreq + flake.driftPhase) * flake.driftAmp
    let x = flake.x + driftX

    // Wrap horizontally too
    x = ((x % width) + width) % width

    // Set font/color only when depth changes (flakes are sorted by depth from init)
    if (flake.depth !== currentDepth) {
      currentDepth = flake.depth
      const cfg = DEPTH_CONFIG[currentDepth]
      ctx.font = `${cfg.fontSize}px "Courier New", Courier, monospace`
      ctx.fillStyle = cfg.color
    }

    ctx.fillText(FLAKE_CHARS[flake.charIndex], x, y)
  }
}

export const snowRenderer: BackgroundRenderer = {
  init: initState,
  draw,
}

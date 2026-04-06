import type { BackgroundRenderer } from './types'

const STAR_CHARS = ['.', '*', '+', '\u00B7', '\u2726'] // . * + · ✦
const STAR_COUNT = 150

interface Star {
  x: number
  y: number
  char: string
  depth: number       // 0 (far) to 1 (near)
  phase: number       // radians offset for brightness pulsing
  pulseSpeed: number  // radians per second
  driftX: number      // px per second
  driftY: number      // px per second
  baseFontSize: number
}

interface StarfieldState {
  stars: Star[]
  width: number
  height: number
}

function initState(width: number, height: number): StarfieldState {
  const stars: Star[] = new Array(STAR_COUNT)

  for (let i = 0; i < STAR_COUNT; i++) {
    const depth = Math.random()
    stars[i] = {
      x: Math.random() * width,
      y: Math.random() * height,
      char: STAR_CHARS[(Math.random() * STAR_CHARS.length) | 0],
      depth,
      phase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.3 + Math.random() * 0.8, // 0.3–1.1 rad/s
      driftX: (Math.random() - 0.5) * 3 * depth, // deeper stars drift less
      driftY: (Math.random() - 0.5) * 2 * depth,
      baseFontSize: 8 + depth * 8, // 8–16px
    }
  }

  return { stars, width, height }
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: unknown,
): void {
  const s = state as StarfieldState

  ctx.clearRect(0, 0, width, height)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const timeSec = time / 1000

  for (let i = 0; i < s.stars.length; i++) {
    const star = s.stars[i]

    // Slow drift with wrapping
    let sx = (star.x + star.driftX * timeSec) % width
    let sy = (star.y + star.driftY * timeSec) % height
    if (sx < 0) sx += width
    if (sy < 0) sy += height

    // Sinusoidal brightness pulsing
    const pulse = Math.sin(timeSec * star.pulseSpeed + star.phase)
    const normalized = (pulse + 1) * 0.5 // 0–1

    // Depth affects base brightness: far stars dimmer
    // zinc-700 #3f3f46 = rgb(63,63,70) for near, zinc-800 #27272a = rgb(39,39,42) for far
    const depthBright = star.depth // 0=far, 1=near
    const r = 39 + depthBright * 24 // 39–63
    const g = 39 + depthBright * 24
    const b = 42 + depthBright * 28 // 42–70

    // Overall alpha: keep it subtle. Far stars 0.05–0.15, near stars 0.10–0.35
    const minAlpha = 0.05 + depthBright * 0.05
    const maxAlpha = 0.15 + depthBright * 0.20
    const alpha = minAlpha + normalized * (maxAlpha - minAlpha)

    ctx.font = `${star.baseFontSize}px sans-serif`
    ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${alpha.toFixed(3)})`
    ctx.fillText(star.char, sx, sy)
  }
}

export const starfieldRenderer: BackgroundRenderer = {
  init: initState,
  draw,
}

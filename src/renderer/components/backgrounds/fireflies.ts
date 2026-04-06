import type { BackgroundRenderer } from './types'

const FIREFLY_COUNT = 35
const TRAIL_LENGTH = 6

interface Firefly {
  // Base position (center of wandering area)
  baseX: number
  baseY: number
  // Sine-combination parameters for organic movement (3 overlapping sines per axis)
  freqX1: number; freqX2: number; freqX3: number
  freqY1: number; freqY2: number; freqY3: number
  ampX1: number; ampX2: number; ampX3: number
  ampY1: number; ampY2: number; ampY3: number
  phaseX1: number; phaseX2: number; phaseX3: number
  phaseY1: number; phaseY2: number; phaseY3: number
  // Glow pulsing
  pulsePhase: number
  pulseSpeed: number
  // Appearance
  radius: number
  // Trail: ring buffer of recent positions
  trail: Float64Array // [x0, y0, x1, y1, ...] length = TRAIL_LENGTH * 2
  trailIdx: number
  lastTrailTime: number
}

interface FireflyState {
  fireflies: Firefly[]
}

function rng(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function initState(width: number, height: number): FireflyState {
  const fireflies: Firefly[] = new Array(FIREFLY_COUNT)

  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const trail = new Float64Array(TRAIL_LENGTH * 2)
    const bx = Math.random() * width
    const by = Math.random() * height
    // Fill trail with base position
    for (let t = 0; t < TRAIL_LENGTH; t++) {
      trail[t * 2] = bx
      trail[t * 2 + 1] = by
    }

    fireflies[i] = {
      baseX: bx,
      baseY: by,
      freqX1: rng(0.1, 0.3), freqX2: rng(0.05, 0.15), freqX3: rng(0.02, 0.08),
      freqY1: rng(0.1, 0.3), freqY2: rng(0.05, 0.15), freqY3: rng(0.02, 0.08),
      ampX1: rng(30, 80), ampX2: rng(20, 60), ampX3: rng(40, 120),
      ampY1: rng(30, 80), ampY2: rng(20, 60), ampY3: rng(40, 120),
      phaseX1: rng(0, Math.PI * 2), phaseX2: rng(0, Math.PI * 2), phaseX3: rng(0, Math.PI * 2),
      phaseY1: rng(0, Math.PI * 2), phaseY2: rng(0, Math.PI * 2), phaseY3: rng(0, Math.PI * 2),
      pulsePhase: rng(0, Math.PI * 2),
      pulseSpeed: rng(0.4, 1.2),
      radius: rng(1.5, 3.5),
      trail,
      trailIdx: 0,
      lastTrailTime: 0,
    }
  }

  return { fireflies }
}

function getPos(f: Firefly, timeSec: number): [number, number] {
  const x = f.baseX
    + Math.sin(timeSec * f.freqX1 + f.phaseX1) * f.ampX1
    + Math.sin(timeSec * f.freqX2 + f.phaseX2) * f.ampX2
    + Math.sin(timeSec * f.freqX3 + f.phaseX3) * f.ampX3
  const y = f.baseY
    + Math.sin(timeSec * f.freqY1 + f.phaseY1) * f.ampY1
    + Math.sin(timeSec * f.freqY2 + f.phaseY2) * f.ampY2
    + Math.sin(timeSec * f.freqY3 + f.phaseY3) * f.ampY3
  return [x, y]
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: unknown,
): void {
  const s = state as FireflyState

  ctx.clearRect(0, 0, width, height)

  const timeSec = time / 1000

  for (let i = 0; i < s.fireflies.length; i++) {
    const f = s.fireflies[i]
    const [fx, fy] = getPos(f, timeSec)

    // Record trail position every ~50ms
    if (time - f.lastTrailTime > 50) {
      f.trail[f.trailIdx * 2] = fx
      f.trail[f.trailIdx * 2 + 1] = fy
      f.trailIdx = (f.trailIdx + 1) % TRAIL_LENGTH
      f.lastTrailTime = time
    }

    // Pulsing: sinusoidal fade in/out
    const pulse = Math.sin(timeSec * f.pulseSpeed + f.pulsePhase)
    const brightness = Math.max(0, (pulse + 1) * 0.5) // 0–1
    // Keep overall alpha low: peak around 0.25
    const alpha = brightness * 0.25

    if (alpha < 0.01) continue // skip invisible fireflies

    // Draw faint trail
    for (let t = 0; t < TRAIL_LENGTH; t++) {
      // Read from ring buffer in order: oldest first
      const idx = (f.trailIdx + t) % TRAIL_LENGTH
      const tx = f.trail[idx * 2]
      const ty = f.trail[idx * 2 + 1]
      const trailAge = (TRAIL_LENGTH - t) / TRAIL_LENGTH // 1=oldest, ~0=newest
      const trailAlpha = alpha * (1 - trailAge) * 0.3 // very faint

      if (trailAlpha < 0.005) continue

      // Warm amber glow: #3d2e0a = rgb(61, 46, 10)
      ctx.fillStyle = `rgba(61, 46, 10, ${trailAlpha.toFixed(3)})`
      ctx.beginPath()
      ctx.arc(tx, ty, f.radius * 0.6, 0, Math.PI * 2)
      ctx.fill()
    }

    // Draw the firefly glow (radial gradient for soft glow)
    const glowRadius = f.radius * (3 + brightness * 2)
    const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, glowRadius)
    // Core: warm amber, brighter
    grad.addColorStop(0, `rgba(82, 66, 20, ${(alpha * 1.2).toFixed(3)})`)
    // Mid: warm dim
    grad.addColorStop(0.4, `rgba(61, 46, 10, ${(alpha * 0.6).toFixed(3)})`)
    // Edge: transparent
    grad.addColorStop(1, 'rgba(61, 46, 10, 0)')

    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(fx, fy, glowRadius, 0, Math.PI * 2)
    ctx.fill()

    // Draw core dot
    ctx.fillStyle = `rgba(92, 76, 30, ${(alpha * 1.5).toFixed(3)})`
    ctx.beginPath()
    ctx.arc(fx, fy, f.radius * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

export const firefliesRenderer: BackgroundRenderer = {
  init: initState,
  draw,
}

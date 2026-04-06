import type { BackgroundRenderer } from './types'

interface Star {
  // Base position (center of orbit)
  baseX: number
  baseY: number
  // Orbital parameters
  orbitRadius: number
  orbitSpeed: number
  orbitPhase: number
  // Secondary orbit for more organic movement
  orbit2Radius: number
  orbit2Speed: number
  orbit2Phase: number
  // Visual
  size: number
  isAnchor: boolean
  pulseSpeed: number
  pulsePhase: number
  baseBrightness: number
}

interface ConstellationState {
  stars: Star[]
  connectionDist: number
  connectionDistSq: number
  // Pre-allocated current position arrays
  currentX: Float64Array
  currentY: Float64Array
}

function init(width: number, height: number): unknown {
  const numStars = 70
  const stars: Star[] = []
  const margin = 40

  for (let i = 0; i < numStars; i++) {
    const isAnchor = i < 12 // ~15% are anchor stars
    stars.push({
      baseX: margin + Math.random() * (width - margin * 2),
      baseY: margin + Math.random() * (height - margin * 2),
      orbitRadius: 5 + Math.random() * 25,
      orbitSpeed: 0.0001 + Math.random() * 0.0003,
      orbitPhase: Math.random() * Math.PI * 2,
      orbit2Radius: 2 + Math.random() * 10,
      orbit2Speed: 0.0002 + Math.random() * 0.0004,
      orbit2Phase: Math.random() * Math.PI * 2,
      size: isAnchor ? 1.5 + Math.random() * 1.0 : 0.7 + Math.random() * 0.8,
      isAnchor,
      pulseSpeed: 0.0008 + Math.random() * 0.0015,
      pulsePhase: Math.random() * Math.PI * 2,
      baseBrightness: isAnchor ? 0.6 + Math.random() * 0.3 : 0.25 + Math.random() * 0.3,
    })
  }

  const connectionDist = 120
  const state: ConstellationState = {
    stars,
    connectionDist,
    connectionDistSq: connectionDist * connectionDist,
    currentX: new Float64Array(numStars),
    currentY: new Float64Array(numStars),
  }
  return state
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  rawState: unknown,
): void {
  const state = rawState as ConstellationState
  ctx.clearRect(0, 0, width, height)

  const { stars, connectionDistSq, connectionDist, currentX, currentY } = state
  const numStars = stars.length

  // Update current positions
  for (let i = 0; i < numStars; i++) {
    const star = stars[i]
    currentX[i] =
      star.baseX +
      Math.cos(time * star.orbitSpeed + star.orbitPhase) * star.orbitRadius +
      Math.sin(time * star.orbit2Speed + star.orbit2Phase) * star.orbit2Radius
    currentY[i] =
      star.baseY +
      Math.sin(time * star.orbitSpeed + star.orbitPhase + 0.5) * star.orbitRadius +
      Math.cos(time * star.orbit2Speed + star.orbit2Phase + 0.5) * star.orbit2Radius
  }

  // Draw connections between nearby stars
  ctx.lineWidth = 0.5
  for (let i = 0; i < numStars; i++) {
    const x1 = currentX[i]
    const y1 = currentY[i]

    for (let j = i + 1; j < numStars; j++) {
      const dx = currentX[j] - x1
      const dy = currentY[j] - y1
      const distSq = dx * dx + dy * dy

      if (distSq < connectionDistSq) {
        const dist = Math.sqrt(distSq)
        // Fade based on distance — closer = more visible
        const fade = 1 - dist / connectionDist
        // Very subtle line color: #161619 with fade
        const alpha = fade * 0.35
        ctx.strokeStyle = `rgba(22, 22, 25, ${alpha})`
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(currentX[j], currentY[j])
        ctx.stroke()
      }
    }
  }

  // Draw star points
  for (let i = 0; i < numStars; i++) {
    const star = stars[i]
    const x = currentX[i]
    const y = currentY[i]

    // Pulsing brightness
    const pulse = Math.sin(time * star.pulseSpeed + star.pulsePhase) * 0.5 + 0.5
    const brightness = star.baseBrightness + pulse * 0.2

    // Map brightness to zinc palette color range
    // #3f3f46 = rgb(63, 63, 70) at full brightness for anchors
    // Dimmer stars range from #27272a to #3f3f46
    const r = Math.round(27 + brightness * 36) // 27..63
    const g = Math.round(27 + brightness * 36)
    const b = Math.round(30 + brightness * 40) // 30..70

    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.beginPath()
    ctx.arc(x, y, star.size, 0, Math.PI * 2)
    ctx.fill()

    // Anchor stars get a subtle glow
    if (star.isAnchor) {
      const glowAlpha = 0.04 + pulse * 0.04
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${glowAlpha})`
      ctx.beginPath()
      ctx.arc(x, y, star.size * 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

export const constellationRenderer: BackgroundRenderer = { init, draw }

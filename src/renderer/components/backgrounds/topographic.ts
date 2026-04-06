import type { BackgroundRenderer } from './types'

interface ContourLine {
  baseRadius: number
  centerXOffset: number
  centerYOffset: number
  // Pre-computed harmonic coefficients for shape variation
  harmonics: { amplitude: number; frequency: number; phase: number }[]
  // Animation parameters
  breathSpeed: number
  breathPhase: number
  driftSpeed: number
  driftPhase: number
  opacity: number
}

interface TopoState {
  contours: ContourLine[]
  numPoints: number // points per contour curve
  // Pre-allocated arrays for drawing
  pointsX: Float64Array
  pointsY: Float64Array
}

function init(width: number, height: number): unknown {
  const numContours = 10
  const numPoints = 72 // every 5 degrees
  const contours: ContourLine[] = []

  const maxDim = Math.max(width, height)

  for (let i = 0; i < numContours; i++) {
    const t = (i + 1) / (numContours + 1)
    const numHarmonics = 4 + Math.floor(Math.random() * 3)
    const harmonics: ContourLine['harmonics'] = []

    for (let h = 0; h < numHarmonics; h++) {
      harmonics.push({
        amplitude: (0.02 + Math.random() * 0.06) * maxDim * 0.3,
        frequency: 2 + Math.floor(Math.random() * 5),
        phase: Math.random() * Math.PI * 2,
      })
    }

    contours.push({
      baseRadius: maxDim * 0.08 + t * maxDim * 0.4,
      centerXOffset: (Math.random() - 0.5) * width * 0.3,
      centerYOffset: (Math.random() - 0.5) * height * 0.3,
      harmonics,
      breathSpeed: 0.0002 + Math.random() * 0.0003,
      breathPhase: Math.random() * Math.PI * 2,
      driftSpeed: 0.00005 + Math.random() * 0.0001,
      driftPhase: Math.random() * Math.PI * 2,
      opacity: 0.15 + Math.random() * 0.2,
    })
  }

  const state: TopoState = {
    contours,
    numPoints,
    pointsX: new Float64Array(numPoints),
    pointsY: new Float64Array(numPoints),
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
  const state = rawState as TopoState
  ctx.clearRect(0, 0, width, height)

  const { contours, numPoints, pointsX, pointsY } = state
  const cx = width / 2
  const cy = height / 2
  const angleStep = (Math.PI * 2) / numPoints

  ctx.lineWidth = 0.7
  ctx.lineJoin = 'round'

  for (let ci = 0; ci < contours.length; ci++) {
    const contour = contours[ci]

    // Breathing effect — subtle radius oscillation
    const breathOffset = Math.sin(time * contour.breathSpeed + contour.breathPhase) * 8

    // Slow drift of center position
    const driftX = Math.sin(time * contour.driftSpeed + contour.driftPhase) * 15
    const driftY = Math.cos(time * contour.driftSpeed * 0.8 + contour.driftPhase + 1) * 15

    const centerX = cx + contour.centerXOffset + driftX
    const centerY = cy + contour.centerYOffset + driftY
    const radius = contour.baseRadius + breathOffset

    // Compute contour points
    for (let i = 0; i < numPoints; i++) {
      const angle = i * angleStep
      let r = radius

      // Sum harmonics to create organic shape
      for (let h = 0; h < contour.harmonics.length; h++) {
        const harm = contour.harmonics[h]
        // Slowly shift phase over time for morphing
        const phaseShift = time * 0.00008 * (h + 1)
        r += harm.amplitude * Math.sin(angle * harm.frequency + harm.phase + phaseShift)
      }

      pointsX[i] = centerX + Math.cos(angle) * r
      pointsY[i] = centerY + Math.sin(angle) * r
    }

    // Interpolate color between #1a1a1f and #27272a based on contour index
    const t = ci / (contours.length - 1)
    const r = Math.round(26 + t * 13) // 0x1a to 0x27
    const g = Math.round(26 + t * 13)
    const b = Math.round(31 + t * 11) // 0x1f to 0x2a
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${contour.opacity})`

    // Draw smooth closed curve using cubic bezier through all points
    ctx.beginPath()

    // Use Catmull-Rom to Bezier conversion for smooth curve
    for (let i = 0; i < numPoints; i++) {
      const i0 = (i - 1 + numPoints) % numPoints
      const i1 = i
      const i2 = (i + 1) % numPoints
      const i3 = (i + 2) % numPoints

      const x0 = pointsX[i0], y0 = pointsY[i0]
      const x1 = pointsX[i1], y1 = pointsY[i1]
      const x2 = pointsX[i2], y2 = pointsY[i2]
      const x3 = pointsX[i3], y3 = pointsY[i3]

      if (i === 0) {
        ctx.moveTo(x1, y1)
      }

      // Catmull-Rom to cubic bezier control points (tension = 0, alpha = 0.5)
      const tension = 6
      const cp1x = x1 + (x2 - x0) / tension
      const cp1y = y1 + (y2 - y0) / tension
      const cp2x = x2 - (x3 - x1) / tension
      const cp2y = y2 - (y3 - y1) / tension

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2)
    }

    ctx.closePath()
    ctx.stroke()
  }
}

export const topographicRenderer: BackgroundRenderer = { init, draw }

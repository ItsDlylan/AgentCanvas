import type { BackgroundRenderer } from './types'

// Wave characters ordered from gentle to intense
const WAVE_CHARS = ['~', '≈', '∿', '∼', '˜']
const FOAM_CHARS = ['.', '·', '°', '˚']

const FONT_SIZE = 14
const CHAR_WIDTH = 9 // approximate monospace char width at 14px

interface WaveLayer {
  y: number           // base vertical position
  speed: number       // horizontal scroll speed (px/s) — negative = right to left
  amplitude: number   // vertical sine amplitude (px)
  frequency: number   // horizontal sine frequency
  phaseOffset: number // starting phase offset
  charIndex: number   // index into WAVE_CHARS
  color: string       // fill color
  foamColor: string   // color for foam particles
  foamThreshold: number // sine value above which foam appears
}

interface FoamParticle {
  colIndex: number    // which text column
  charIndex: number   // index into FOAM_CHARS
  offsetY: number     // small vertical offset from wave
}

interface OceanState {
  layers: WaveLayer[]
  charsPerRow: number
  foam: FoamParticle[][] // one array of foam particles per layer
}

function initState(width: number, height: number): OceanState {
  const charsPerRow = Math.ceil(width / CHAR_WIDTH) + 4

  // 6 wave layers — back (slow, dim) to front (faster, slightly brighter)
  const layerConfigs = [
    { yFrac: 0.15, speed: 8,  amp: 6,  freq: 0.008, color: '#111114', foamColor: '#141418' },
    { yFrac: 0.28, speed: 12, amp: 8,  freq: 0.010, color: '#121216', foamColor: '#151519' },
    { yFrac: 0.42, speed: 17, amp: 10, freq: 0.012, color: '#141418', foamColor: '#17171c' },
    { yFrac: 0.56, speed: 22, amp: 12, freq: 0.014, color: '#16161b', foamColor: '#1a1a1f' },
    { yFrac: 0.70, speed: 28, amp: 14, freq: 0.011, color: '#19191e', foamColor: '#1c1c22' },
    { yFrac: 0.84, speed: 35, amp: 10, freq: 0.016, color: '#1e1e24', foamColor: '#222228' },
  ]

  const layers: WaveLayer[] = layerConfigs.map((cfg, i) => ({
    y: height * cfg.yFrac,
    speed: cfg.speed,
    amplitude: cfg.amp,
    frequency: cfg.freq,
    phaseOffset: i * 1.3,
    charIndex: i % WAVE_CHARS.length,
    color: cfg.color,
    foamColor: cfg.foamColor,
    foamThreshold: 0.7,
  }))

  // Pre-allocate foam particles for each layer
  const foam: FoamParticle[][] = layers.map(() => {
    const particles: FoamParticle[] = []
    const count = 8 + (Math.random() * 8) | 0
    for (let j = 0; j < count; j++) {
      particles.push({
        colIndex: (Math.random() * charsPerRow) | 0,
        charIndex: (Math.random() * FOAM_CHARS.length) | 0,
        offsetY: -(2 + Math.random() * 10),
      })
    }
    return particles
  })

  return { layers, charsPerRow, foam }
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: unknown,
): void {
  const s = state as OceanState

  ctx.clearRect(0, 0, width, height)
  ctx.font = `${FONT_SIZE}px "Courier New", Courier, monospace`
  ctx.textBaseline = 'middle'

  const timeSec = time / 1000

  for (let li = 0; li < s.layers.length; li++) {
    const layer = s.layers[li]
    const scrollOffset = layer.speed * timeSec
    const waveChar = WAVE_CHARS[layer.charIndex]

    ctx.fillStyle = layer.color

    // Draw each character along the horizontal wave
    for (let ci = 0; ci < s.charsPerRow; ci++) {
      const x = ci * CHAR_WIDTH
      // Sine wave position — scroll creates right-to-left motion
      const sineInput = (x + scrollOffset) * layer.frequency + layer.phaseOffset
      const sineVal = Math.sin(sineInput)
      const y = layer.y + sineVal * layer.amplitude

      // Alternate wave characters slightly based on sine phase
      const charVariant = sineVal > 0.3 ? waveChar : WAVE_CHARS[(layer.charIndex + 1) % WAVE_CHARS.length]
      ctx.fillText(charVariant, x, y)
    }

    // Draw foam near wave peaks
    ctx.fillStyle = layer.foamColor
    const foamParticles = s.foam[li]
    for (let fi = 0; fi < foamParticles.length; fi++) {
      const fp = foamParticles[fi]
      const x = fp.colIndex * CHAR_WIDTH
      const sineInput = (x + scrollOffset) * layer.frequency + layer.phaseOffset
      const sineVal = Math.sin(sineInput)

      // Only show foam near peaks
      if (sineVal > layer.foamThreshold) {
        const y = layer.y + sineVal * layer.amplitude + fp.offsetY
        ctx.fillText(FOAM_CHARS[fp.charIndex], x, y)
      }
    }

    // Slowly migrate foam particles across the wave (no allocations)
    if (((time | 0) % 3) === 0) {
      for (let fi = 0; fi < foamParticles.length; fi++) {
        foamParticles[fi].colIndex = (foamParticles[fi].colIndex + 1) % s.charsPerRow
      }
    }
  }
}

export const oceanRenderer: BackgroundRenderer = {
  init: initState,
  draw,
}

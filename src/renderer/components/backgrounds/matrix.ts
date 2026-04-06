import type { BackgroundRenderer } from './types'

// Katakana range U+30A0–U+30FF, plus latin uppercase and digits
const CHAR_POOL: string[] = []
for (let i = 0x30a0; i <= 0x30ff; i++) CHAR_POOL.push(String.fromCharCode(i))
for (let i = 65; i <= 90; i++) CHAR_POOL.push(String.fromCharCode(i))
for (let i = 48; i <= 57; i++) CHAR_POOL.push(String.fromCharCode(i))

const FONT_SIZE = 14
const COL_COUNT_TARGET = 50 // aim for ~50 columns

interface Column {
  x: number
  speed: number       // pixels per second
  y: number           // current head position (px)
  length: number      // how many chars in the trail
  chars: number[]     // indices into CHAR_POOL, pre-allocated
  nextSwap: number    // time of next random char swap (ms)
  swapInterval: number // ms between swaps
}

interface MatrixState {
  columns: Column[]
  colSpacing: number
}

function randomChar(): number {
  return (Math.random() * CHAR_POOL.length) | 0
}

function initState(width: number, height: number): MatrixState {
  const colSpacing = Math.max(FONT_SIZE, width / COL_COUNT_TARGET)
  const numCols = Math.ceil(width / colSpacing)
  const maxTrail = Math.ceil(height / FONT_SIZE) + 4

  const columns: Column[] = []
  for (let i = 0; i < numCols; i++) {
    const length = 8 + ((Math.random() * (maxTrail - 8)) | 0)
    const chars: number[] = new Array(length)
    for (let j = 0; j < length; j++) chars[j] = randomChar()

    columns.push({
      x: i * colSpacing + colSpacing * 0.5,
      speed: 30 + Math.random() * 50, // 30–80 px/s — slow and subtle
      y: -Math.random() * height * 1.5, // stagger start above viewport
      length,
      chars,
      nextSwap: Math.random() * 2000,
      swapInterval: 400 + Math.random() * 800,
    })
  }

  return { columns, colSpacing }
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: unknown,
): void {
  const s = state as MatrixState

  ctx.clearRect(0, 0, width, height)
  ctx.font = `${FONT_SIZE}px "Courier New", Courier, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  const timeSec = time / 1000

  for (let c = 0; c < s.columns.length; c++) {
    const col = s.columns[c]

    // Advance position
    col.y = ((col.speed * timeSec) % (height + col.length * FONT_SIZE)) - col.length * FONT_SIZE

    // Randomly swap a character occasionally
    if (time > col.nextSwap) {
      col.chars[(Math.random() * col.length) | 0] = randomChar()
      col.nextSwap = time + col.swapInterval
    }

    // Draw each character in the column
    for (let i = 0; i < col.length; i++) {
      const cy = col.y + i * FONT_SIZE
      if (cy < -FONT_SIZE || cy > height) continue

      const isHead = i === col.length - 1
      const fade = i / col.length // 0 at top (oldest), 1 at bottom (newest)

      if (isHead) {
        // Leading char: slightly brighter green
        ctx.fillStyle = `rgba(10, 92, 10, ${0.35 * fade})`
      } else {
        // Trail chars: very dim green
        const alpha = 0.06 + 0.14 * fade // 0.06–0.20
        ctx.fillStyle = `rgba(15, 61, 15, ${alpha})`
      }

      ctx.fillText(CHAR_POOL[col.chars[i]], col.x, cy)
    }
  }
}

export const matrixRenderer: BackgroundRenderer = {
  init: initState,
  draw,
}

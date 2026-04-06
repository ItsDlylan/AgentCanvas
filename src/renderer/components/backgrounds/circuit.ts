import type { BackgroundRenderer } from './types'

// Box-drawing characters for circuit traces
const HORIZONTAL = '\u2500'
const VERTICAL = '\u2502'
const TOP_LEFT = '\u250C'
const TOP_RIGHT = '\u2510'
const BOTTOM_LEFT = '\u2514'
const BOTTOM_RIGHT = '\u2518'
const T_RIGHT = '\u251C'
const T_LEFT = '\u2524'
const T_DOWN = '\u252C'
const T_UP = '\u2534'
const CROSS = '\u253C'
const NODE_FILLED = '\u25CF'
const NODE_HOLLOW = '\u25CB'

const TRACE_CHARS = [
  HORIZONTAL, VERTICAL, TOP_LEFT, TOP_RIGHT,
  BOTTOM_LEFT, BOTTOM_RIGHT, T_RIGHT, T_LEFT,
  T_DOWN, T_UP, CROSS,
]

// Which directions each character connects: [up, right, down, left]
const CONNECTIONS: Record<string, [boolean, boolean, boolean, boolean]> = {
  [HORIZONTAL]:   [false, true,  false, true],
  [VERTICAL]:     [true,  false, true,  false],
  [TOP_LEFT]:     [false, true,  true,  false],
  [TOP_RIGHT]:    [false, false, true,  true],
  [BOTTOM_LEFT]:  [true,  true,  false, false],
  [BOTTOM_RIGHT]: [true,  false, false, true],
  [T_RIGHT]:      [true,  true,  true,  false],
  [T_LEFT]:       [true,  false, true,  true],
  [T_DOWN]:       [false, true,  true,  true],
  [T_UP]:         [true,  true,  false, true],
  [CROSS]:        [true,  true,  true,  true],
}

interface CellInfo {
  char: string
  isNode: boolean
}

interface Pulse {
  pathIndex: number
  position: number // 0..1 along the path
  speed: number
}

interface TracePath {
  cells: { col: number; row: number }[]
}

interface CircuitState {
  cols: number
  rows: number
  cellSize: number
  grid: (CellInfo | null)[][]
  paths: TracePath[]
  pulses: Pulse[]
  lastTime: number
}

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

function buildGrid(
  cols: number,
  rows: number,
  rand: () => number,
): (CellInfo | null)[][] {
  const grid: (CellInfo | null)[][] = []
  for (let r = 0; r < rows; r++) {
    grid[r] = []
    for (let c = 0; c < cols; c++) {
      // ~30% chance of a cell having a trace character
      if (rand() < 0.3) {
        const char = TRACE_CHARS[Math.floor(rand() * TRACE_CHARS.length)]
        const isNode = rand() < 0.15
        grid[r][c] = { char: isNode ? (rand() < 0.5 ? NODE_FILLED : NODE_HOLLOW) : char, isNode }
      } else {
        grid[r][c] = null
      }
    }
  }
  return grid
}

function findPaths(
  grid: (CellInfo | null)[][],
  cols: number,
  rows: number,
  rand: () => number,
): TracePath[] {
  const paths: TracePath[] = []
  // Direction offsets: up, right, down, left
  const dr = [-1, 0, 1, 0]
  const dc = [0, 1, 0, -1]

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c]
      if (!cell || cell.isNode) continue
      const conn = CONNECTIONS[cell.char]
      if (!conn) continue

      // Try to build a path starting from the right or down direction
      for (const startDir of [1, 2]) {
        if (!conn[startDir]) continue
        const path: { col: number; row: number }[] = [{ col: c, row: r }]
        let cr = r + dr[startDir]
        let cc = c + dc[startDir]
        const visited = new Set<string>()
        visited.add(`${r},${c}`)

        for (let step = 0; step < 20; step++) {
          if (cr < 0 || cr >= rows || cc < 0 || cc >= cols) break
          const key = `${cr},${cc}`
          if (visited.has(key)) break
          const next = grid[cr][cc]
          if (!next) break
          visited.add(key)
          path.push({ col: cc, row: cr })

          // Pick a connected direction to continue
          const nextConn = next.isNode ? [true, true, true, true] as const : CONNECTIONS[next.char]
          if (!nextConn) break
          let moved = false
          // Shuffle directions to add variety
          const dirs = [0, 1, 2, 3].sort(() => rand() - 0.5)
          for (const d of dirs) {
            if (!nextConn[d]) continue
            const nr = cr + dr[d]
            const nc = cc + dc[d]
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
            if (visited.has(`${nr},${nc}`)) continue
            if (!grid[nr][nc]) continue
            cr = nr
            cc = nc
            moved = true
            break
          }
          if (!moved) break
        }

        if (path.length >= 3) {
          paths.push({ cells: path })
        }
      }
    }
  }

  // Keep a reasonable number of paths
  return paths.slice(0, 60)
}

function init(width: number, height: number): unknown {
  const cellSize = 20
  const cols = Math.ceil(width / cellSize) + 2
  const rows = Math.ceil(height / cellSize) + 2
  const rand = seededRandom(Date.now())

  const grid = buildGrid(cols, rows, rand)
  const paths = findPaths(grid, cols, rows, rand)

  // Create initial pulses
  const pulses: Pulse[] = []
  const numPulses = Math.min(paths.length, 15)
  for (let i = 0; i < numPulses; i++) {
    pulses.push({
      pathIndex: Math.floor(rand() * paths.length),
      position: rand(),
      speed: 0.03 + rand() * 0.05,
    })
  }

  const state: CircuitState = {
    cols,
    rows,
    cellSize,
    grid,
    paths,
    pulses,
    lastTime: 0,
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
  const state = rawState as CircuitState
  ctx.clearRect(0, 0, width, height)

  const { cellSize, grid, rows, cols, paths, pulses } = state

  // Compute delta time in seconds
  const dt = state.lastTime === 0 ? 0.016 : (time - state.lastTime) / 1000
  state.lastTime = time

  // Draw static circuit traces
  ctx.font = `${cellSize * 0.8}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c]
      if (!cell) continue

      const x = c * cellSize + cellSize / 2
      const y = r * cellSize + cellSize / 2

      if (cell.isNode) {
        ctx.fillStyle = '#27272a'
        ctx.fillText(cell.char, x, y)
      } else {
        ctx.fillStyle = '#1a1a1f'
        ctx.fillText(cell.char, x, y)
      }
    }
  }

  // Update and draw pulses
  for (const pulse of pulses) {
    pulse.position += pulse.speed * dt
    if (pulse.position > 1) {
      pulse.position = 0
      // Reassign to a random path
      pulse.pathIndex = (pulse.pathIndex + 1 + Math.floor(Math.random() * 3)) % paths.length
    }

    const path = paths[pulse.pathIndex]
    if (!path || path.cells.length < 2) continue

    // Find current position along path
    const totalSegments = path.cells.length - 1
    const segFloat = pulse.position * totalSegments
    const segIndex = Math.min(Math.floor(segFloat), totalSegments - 1)
    const segFrac = segFloat - segIndex

    const c0 = path.cells[segIndex]
    const c1 = path.cells[Math.min(segIndex + 1, path.cells.length - 1)]

    const px = (c0.col + (c1.col - c0.col) * segFrac) * cellSize + cellSize / 2
    const py = (c0.row + (c1.row - c0.row) * segFrac) * cellSize + cellSize / 2

    // Draw pulse glow
    const gradient = ctx.createRadialGradient(px, py, 0, px, py, cellSize * 2.5)
    gradient.addColorStop(0, 'rgba(26, 42, 63, 0.5)')
    gradient.addColorStop(0.5, 'rgba(26, 42, 63, 0.15)')
    gradient.addColorStop(1, 'rgba(26, 42, 63, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(px - cellSize * 3, py - cellSize * 3, cellSize * 6, cellSize * 6)

    // Draw pulse core
    ctx.beginPath()
    ctx.arc(px, py, 2, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(40, 60, 90, 0.7)'
    ctx.fill()
  }
}

export const circuitRenderer: BackgroundRenderer = { init, draw }

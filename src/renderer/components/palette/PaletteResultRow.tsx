import type { PaletteTile } from '@/lib/palette-corpus'
import type { PaletteCommand } from '@/lib/palette-commands'

export interface TileResultItem {
  kind: 'tile'
  tile: PaletteTile
  matchPositions: Set<number>
  workspaceName?: string
  isCrossWorkspace: boolean
}

export interface CommandResultItem {
  kind: 'command'
  command: PaletteCommand
  matchPositions: Set<number>
}

export interface ScrollbackResultItem {
  kind: 'scrollback'
  terminalId: string
  terminalLabel: string
  lineNo: number
  snippet: string
  ts: number
}

export interface WorkspaceResultItem {
  kind: 'workspace'
  workspace: { id: string; name: string }
  matchPositions: Set<number>
  isActive: boolean
}

export type PaletteResultItem =
  | TileResultItem
  | CommandResultItem
  | ScrollbackResultItem
  | WorkspaceResultItem

const TYPE_ICON: Record<PaletteTile['type'], string> = {
  terminal: '▸',
  browser: '◷',
  notes: '☰',
  draw: '✎',
  image: '▣'
}

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-green-500/20 text-green-300 ring-green-500/30',
  waiting: 'bg-amber-500/20 text-amber-300 ring-amber-500/30',
  idle: 'bg-zinc-700/40 text-zinc-400 ring-zinc-600/40'
}

function highlight(text: string, positions: Set<number>): React.ReactNode {
  if (positions.size === 0) return text
  const out: React.ReactNode[] = []
  let run: number[] = []
  const flush = (isMatch: boolean) => {
    if (run.length === 0) return
    const slice = run.map((i) => text[i]).join('')
    out.push(
      isMatch ? (
        <mark key={out.length} className="bg-transparent font-semibold text-sky-300">
          {slice}
        </mark>
      ) : (
        <span key={out.length}>{slice}</span>
      )
    )
    run = []
  }
  let currentMatch = positions.has(0)
  for (let i = 0; i < text.length; i++) {
    const isMatch = positions.has(i)
    if (isMatch === currentMatch) {
      run.push(i)
    } else {
      flush(currentMatch)
      currentMatch = isMatch
      run.push(i)
    }
  }
  flush(currentMatch)
  return out
}

interface PaletteResultRowProps {
  item: PaletteResultItem
  selected: boolean
  quickIndex?: number
  onClick: () => void
}

export function PaletteResultRow({ item, selected, quickIndex, onClick }: PaletteResultRowProps) {
  const selectedCls = selected
    ? 'bg-zinc-800/80 ring-1 ring-sky-500/40'
    : 'hover:bg-zinc-800/60'

  if (item.kind === 'tile') {
    const { tile, matchPositions, workspaceName, isCrossWorkspace } = item
    const secondary = tile.cwd ?? tile.url ?? ''
    const status = tile.status
    return (
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors ${selectedCls}`}
      >
        <span className="w-5 flex-none text-center text-sm text-zinc-500">{TYPE_ICON[tile.type]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-zinc-200">{highlight(tile.label, matchPositions)}</span>
            {status && (
              <span className={`rounded px-1 py-px text-[9px] font-medium ring-1 ${STATUS_COLOR[status] ?? STATUS_COLOR.idle}`}>
                {status}
              </span>
            )}
            {isCrossWorkspace && workspaceName && (
              <span className="rounded bg-zinc-800 px-1 py-px text-[9px] text-zinc-400">{workspaceName}</span>
            )}
          </div>
          {secondary && <div className="truncate text-[11px] text-zinc-500">{secondary}</div>}
          {tile.metadata.team && (
            <div className="text-[10px] text-zinc-600">team: {tile.metadata.team}</div>
          )}
        </div>
        {quickIndex !== undefined && quickIndex < 9 && (
          <span className="flex-none rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
            ⌘{quickIndex + 1}
          </span>
        )}
      </button>
    )
  }

  if (item.kind === 'command') {
    const { command, matchPositions } = item
    return (
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors ${selectedCls}`}
      >
        <span className="w-5 flex-none text-center text-sm text-zinc-500">›</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-zinc-200">{highlight(command.label, matchPositions)}</span>
            <span className="rounded bg-zinc-800 px-1 py-px text-[9px] text-zinc-500">{command.section}</span>
          </div>
        </div>
        {command.hotkey && (
          <span className="flex-none font-mono text-[10px] text-zinc-500">{command.hotkey}</span>
        )}
      </button>
    )
  }

  if (item.kind === 'workspace') {
    const { workspace, matchPositions, isActive } = item
    return (
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors ${selectedCls}`}
      >
        <span className="w-5 flex-none text-center text-sm text-zinc-500">⎔</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-zinc-200">{highlight(workspace.name, matchPositions)}</span>
            <span className="rounded bg-zinc-800 px-1 py-px text-[9px] text-zinc-500">workspace</span>
            {isActive && (
              <span className="rounded bg-sky-500/20 px-1 py-px text-[9px] text-sky-300 ring-1 ring-sky-500/30">active</span>
            )}
          </div>
        </div>
        {quickIndex !== undefined && quickIndex < 9 && (
          <span className="flex-none rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
            ⌘{quickIndex + 1}
          </span>
        )}
      </button>
    )
  }

  // Scrollback
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors ${selectedCls}`}
    >
      <span className="w-5 flex-none text-center text-sm text-zinc-500">?</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-zinc-200">{item.terminalLabel}</span>
          <span className="rounded bg-zinc-800 px-1 py-px font-mono text-[9px] text-zinc-500">line {item.lineNo}</span>
        </div>
        <div className="truncate font-mono text-[11px] text-zinc-500">{item.snippet}</div>
      </div>
    </button>
  )
}

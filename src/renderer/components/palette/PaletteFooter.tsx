import type { PalettePrefix } from '@/lib/palette-search'

const CHIPS: Array<{ prefix: PalettePrefix; hint: string }> = [
  { prefix: '>', hint: 'cmd' },
  { prefix: '?', hint: 'search' },
  { prefix: '#', hint: 'team' },
  { prefix: '@', hint: 'workspace' },
  { prefix: ':', hint: 'state' }
]

interface PaletteFooterProps {
  total: number
  shown: number
  onInsertPrefix: (prefix: PalettePrefix) => void
}

export function PaletteFooter({ total, shown, onInsertPrefix }: PaletteFooterProps) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-900/80 px-3 text-[10px] text-zinc-500">
      <div className="flex items-center gap-1">
        {CHIPS.map((chip, i) => (
          <span key={chip.prefix} className="flex items-center">
            {i > 0 && <span className="mx-1 text-zinc-700">·</span>}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onInsertPrefix(chip.prefix)}
              className="rounded px-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              <span className="font-mono text-zinc-300">{chip.prefix}</span>
              <span className="ml-0.5">{chip.hint}</span>
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 font-mono">
        <span>↵ focus</span>
        <span className="text-zinc-700">·</span>
        <span>⌥↵ keep open</span>
        <span className="text-zinc-700">·</span>
        <span>⎋ close</span>
        <span className="text-zinc-700">·</span>
        <span>
          {shown} of {total}
        </span>
      </div>
    </div>
  )
}

import { forwardRef } from 'react'
import type { KeyboardEvent, ChangeEvent } from 'react'
import type { ParsedQuery } from '@/lib/palette-search'

interface PaletteInputProps {
  value: string
  parsed: ParsedQuery
  onChange: (value: string) => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
}

export const PaletteInput = forwardRef<HTMLInputElement, PaletteInputProps>(
  function PaletteInput({ value, parsed, onChange, onKeyDown }, ref) {
    const handleChange = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)

    return (
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
        {parsed.prefix && (
          <span className="flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-xs text-sky-300 ring-1 ring-sky-500/30">
            <span>{parsed.prefix}</span>
            {parsed.prefixArg && <span className="text-sky-200">{parsed.prefixArg}</span>}
          </span>
        )}
        <input
          ref={ref}
          type="text"
          autoFocus
          spellCheck={false}
          value={value}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          placeholder="Search tiles. > commands · ? scrollback · @workspace · #team · :state"
          className="flex-1 bg-transparent font-mono text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
        />
      </div>
    )
  }
)

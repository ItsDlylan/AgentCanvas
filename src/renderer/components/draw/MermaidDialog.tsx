/**
 * Mermaid import dialog for the Draw tile.
 * Paste Mermaid flowchart syntax → convert to shapes and arrows.
 */
import { useState, useCallback } from 'react'
import { parseMermaid } from '@/lib/mermaid-parser'
import { layoutMermaidGraph } from '@/lib/mermaid-layout'
import type { Shape, Arrow } from '@/lib/draw-types'

interface MermaidDialogProps {
  open: boolean
  onClose: () => void
  onImport: (shapes: Shape[], arrows: Arrow[], mode: 'append' | 'replace') => void
}

const EXAMPLE = `graph TD
    A[Client] --> B[API Gateway]
    B --> C[Auth Service]
    B --> D[Data Service]
    C --> E[(Database)]
    D --> E`

export function MermaidDialog({ open, onClose, onImport }: MermaidDialogProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'append' | 'replace'>('append')

  const handleConvert = useCallback(() => {
    try {
      const trimmed = text.trim()
      if (!trimmed) {
        setError('Please enter Mermaid syntax')
        return
      }

      const graph = parseMermaid(trimmed)
      if (graph.nodes.length === 0) {
        setError('No nodes found in the Mermaid diagram')
        return
      }

      const { shapes, arrows } = layoutMermaidGraph(graph, 50, 50)
      onImport(shapes, arrows, mode)
      setText('')
      setError(null)
      onClose()
    } catch (e) {
      setError(`Parse error: ${(e as Error).message}`)
    }
  }, [text, mode, onImport, onClose])

  const handleExample = useCallback(() => {
    setText(EXAMPLE)
    setError(null)
  }, [])

  if (!open) return null

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 rounded-b-lg">
      <div className="w-[90%] max-w-md rounded-lg border border-zinc-700 bg-zinc-800 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-200">Import Mermaid Diagram</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null) }}
          placeholder="Paste Mermaid flowchart syntax here..."
          className="w-full h-40 rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 font-mono placeholder-zinc-600 focus:border-blue-500 focus:outline-none resize-none"
          spellCheck={false}
        />

        {error && (
          <p className="mt-1 text-xs text-red-400">{error}</p>
        )}

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleExample}
              className="text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              Load example
            </button>
            <label className="flex items-center gap-1.5 text-[10px] text-zinc-400">
              <input
                type="checkbox"
                checked={mode === 'replace'}
                onChange={(e) => setMode(e.target.checked ? 'replace' : 'append')}
                className="rounded border-zinc-600"
              />
              Replace existing
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
            >
              Cancel
            </button>
            <button
              onClick={handleConvert}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500"
            >
              Convert
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

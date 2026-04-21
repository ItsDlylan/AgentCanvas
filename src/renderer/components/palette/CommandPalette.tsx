import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useCanvasStore } from '@/store/canvas-store'
import { usePaletteCorpus } from '@/lib/palette-corpus'
import { useCommands } from '@/lib/palette-commands'
import { parseQuery, rank, type PalettePrefix, type ParsedQuery } from '@/lib/palette-search'
import { Fzf, type FzfResultItem } from 'fzf'
import { PaletteInput } from './PaletteInput'
import { PaletteList } from './PaletteList'
import { PaletteFooter } from './PaletteFooter'
import type { PaletteResultItem, ScrollbackResultItem, CommandResultItem, TileResultItem, WorkspaceResultItem } from './PaletteResultRow'
import type { PaletteCommand } from '@/lib/palette-commands'

const HISTORY_STORAGE_KEY = 'agentcanvas.palette.queryHistory'
const HISTORY_MAX = 20
const RERANK_DEBOUNCE_MS = 200
const SCROLLBACK_DEBOUNCE_MS = 120
const PREFIX_CYCLE: Array<PalettePrefix | null> = [null, '>', '?', '#', '@', ':']

interface HistoryMap {
  [workspaceId: string]: string[]
}

function loadHistory(): HistoryMap {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function saveHistory(history: HistoryMap): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
  } catch {
    // ignore
  }
}

function pushHistory(history: HistoryMap, workspaceId: string, query: string): HistoryMap {
  if (!query.trim()) return history
  const existing = history[workspaceId] ?? []
  const next = [query, ...existing.filter((q) => q !== query)].slice(0, HISTORY_MAX)
  return { ...history, [workspaceId]: next }
}

export function CommandPalette(): JSX.Element | null {
  const paletteOpen = useCanvasStore((s) => s.paletteOpen)
  const closePalette = useCanvasStore((s) => s.closePalette)
  const activeWorkspaceId = useCanvasStore((s) => s.activeWorkspaceId)
  const workspaces = useCanvasStore((s) => s.workspaces)
  const recencyList = useCanvasStore((s) => s.recencyList)
  const focusTile = useCanvasStore((s) => s.focusTile)
  const jumpToScrollbackMatch = useCanvasStore((s) => s.jumpToScrollbackMatch)
  const allNodes = useCanvasStore((s) => s.allNodes)

  const corpus = usePaletteCorpus()
  const commands = useCommands()

  const [input, setInput] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [debouncedInput, setDebouncedInput] = useState('')
  const [scrollbackResults, setScrollbackResults] = useState<ScrollbackResultItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rerankTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const parsed: ParsedQuery = useMemo(() => parseQuery(debouncedInput), [debouncedInput])

  // Reset on open, refocus input
  useEffect(() => {
    if (paletteOpen) {
      setInput('')
      setDebouncedInput('')
      setSelectedIndex(0)
      setScrollbackResults([])
      // Focus input on next frame
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [paletteOpen])

  // Debounce input → ranking
  useEffect(() => {
    if (rerankTimerRef.current) clearTimeout(rerankTimerRef.current)
    rerankTimerRef.current = setTimeout(() => {
      setDebouncedInput(input)
    }, RERANK_DEBOUNCE_MS)
    return () => {
      if (rerankTimerRef.current) clearTimeout(rerankTimerRef.current)
    }
  }, [input])

  // Scrollback search when prefix is '?'
  useEffect(() => {
    if (scrollbackTimerRef.current) clearTimeout(scrollbackTimerRef.current)
    if (parsed.prefix !== '?' || parsed.terms.length === 0) {
      setScrollbackResults([])
      return
    }

    const terms = parsed.terms
    scrollbackTimerRef.current = setTimeout(async () => {
      try {
        const results = await window.search.scrollback(terms, { limit: 20 })
        const labelLookup = new Map<string, string>()
        for (const node of allNodes) {
          const data = node.data as Record<string, unknown>
          labelLookup.set((data.sessionId as string) ?? node.id, (data.label as string) ?? '')
        }
        const mapped: ScrollbackResultItem[] = results.map((r) => ({
          kind: 'scrollback',
          terminalId: r.terminalId,
          terminalLabel: labelLookup.get(r.terminalId) ?? 'Terminal',
          lineNo: r.lineNo,
          snippet: r.snippet,
          ts: r.ts
        }))
        setScrollbackResults(mapped)
      } catch (err) {
        console.error('[CommandPalette] scrollback search failed', err)
        setScrollbackResults([])
      }
    }, SCROLLBACK_DEBOUNCE_MS)

    return () => {
      if (scrollbackTimerRef.current) clearTimeout(scrollbackTimerRef.current)
    }
  }, [parsed.prefix, parsed.terms, allNodes])

  // Build results
  const items: PaletteResultItem[] = useMemo(() => {
    // `?` → scrollback hits
    if (parsed.prefix === '?') {
      return scrollbackResults
    }

    // `>` → command fuzzy match
    if (parsed.prefix === '>') {
      const terms = parsed.terms
      if (terms.length === 0) {
        return commands.map((cmd) => ({
          kind: 'command' as const,
          command: cmd,
          matchPositions: new Set<number>()
        }))
      }
      const fzf = new Fzf(commands, { selector: (c: PaletteCommand) => [c.label, ...c.keywords].join(' '), limit: 50 })
      const results = fzf.find(terms) as FzfResultItem<PaletteCommand>[]
      return results.map((r) => {
        // positions refer to the concatenated keyword string — label highlights only if within label length
        const labelLen = r.item.label.length
        const labelPositions = new Set<number>()
        for (const p of r.positions) if (p < labelLen) labelPositions.add(p)
        const item: CommandResultItem = {
          kind: 'command',
          command: r.item,
          matchPositions: labelPositions
        }
        return item
      })
    }

    // `@` → workspace picker (compose mode) OR tile/command filter scoped to workspace
    if (parsed.prefix === '@') {
      // Compose mode is signaled by whitespace after the workspace name.
      const rawAfterAt = debouncedInput.trimStart().slice(1)
      const composedMode = /\s/.test(rawAfterAt)
      const arg = (parsed.prefixArg ?? '').toLowerCase()
      const resolved = arg
        ? workspaces.find((w) => w.name.toLowerCase() === arg)
        : undefined

      if (resolved && composedMode) {
        // Filter mode: parse the tail for a secondary prefix (`:state`, `#team`, `>command`)
        const scopedCorpus = corpus.filter((t) => t.workspaceId === resolved.id)
        const innerParsed = parseQuery(parsed.terms)

        // Secondary `>` → commands with workspace context
        if (innerParsed.prefix === '>') {
          const terms = innerParsed.terms
          if (terms.length === 0) {
            return commands.map((cmd) => ({
              kind: 'command' as const,
              command: cmd,
              matchPositions: new Set<number>()
            }))
          }
          const fzf = new Fzf(commands, {
            selector: (c: PaletteCommand) => [c.label, ...c.keywords].join(' '),
            limit: 50
          })
          const results = fzf.find(terms) as FzfResultItem<PaletteCommand>[]
          return results.map((r) => {
            const labelLen = r.item.label.length
            const labelPositions = new Set<number>()
            for (const p of r.positions) if (p < labelLen) labelPositions.add(p)
            const commandItem: CommandResultItem = {
              kind: 'command',
              command: r.item,
              matchPositions: labelPositions
            }
            return commandItem
          })
        }

        // Tile ranking (default / `:state` / `#team` all flow through rank+filterCorpus)
        const matches = rank(scopedCorpus, innerParsed, { recencyList, activeWorkspaceId })
        return matches.map((m): TileResultItem => ({
          kind: 'tile',
          tile: m.tile,
          matchPositions: m.matchPositions,
          workspaceName: resolved.name,
          isCrossWorkspace: m.tile.workspaceId !== activeWorkspaceId
        }))
      }

      // Picker mode: fuzzy-filter workspaces by whatever the user has typed so far
      const candidates = arg.length > 0
        ? (new Fzf(workspaces, { selector: (w: { name: string }) => w.name, limit: 50 })
            .find(arg) as FzfResultItem<{ id: string; name: string }>[])
            .map((r) => ({ workspace: r.item, positions: r.positions }))
        : workspaces.map((w) => ({ workspace: w, positions: new Set<number>() }))

      return candidates.map((c): WorkspaceResultItem => ({
        kind: 'workspace',
        workspace: { id: c.workspace.id, name: c.workspace.name },
        matchPositions: c.positions,
        isActive: c.workspace.id === activeWorkspaceId
      }))
    }

    // Default / # / : → tile fuzzy ranking
    // rank() already handles filterCorpus for prefixArg
    const matches = rank(corpus, parsed, { recencyList, activeWorkspaceId })

    // Empty input: top 10 recents
    const sliced = parsed.terms.length === 0 ? matches.slice(0, 10) : matches

    return sliced.map((m): TileResultItem => {
      const ws = workspaces.find((w) => w.id === m.tile.workspaceId)
      return {
        kind: 'tile',
        tile: m.tile,
        matchPositions: m.matchPositions,
        workspaceName: ws?.name,
        isCrossWorkspace: m.tile.workspaceId !== activeWorkspaceId
      }
    })
  }, [parsed, debouncedInput, corpus, commands, scrollbackResults, recencyList, activeWorkspaceId, workspaces])

  // Reset selection when result set changes
  useEffect(() => {
    setSelectedIndex((prev) => (prev >= items.length ? 0 : prev))
  }, [items.length])

  const recordHistory = useCallback(() => {
    const history = loadHistory()
    saveHistory(pushHistory(history, activeWorkspaceId, input))
  }, [activeWorkspaceId, input])

  const activate = useCallback(
    (index: number, keepOpen: boolean) => {
      const item = items[index]
      if (!item) return
      recordHistory()

      if (item.kind === 'tile') {
        focusTile(item.tile.id)
        if (!keepOpen) closePalette()
        return
      }

      if (item.kind === 'command') {
        const workspaceId = parsed.prefix === '@' ? parsed.prefixArg : undefined
        // Resolve arg (user supplies workspace id or name)
        const wsArg = workspaceId
          ? workspaces.find((w) => w.id === workspaceId || w.name.toLowerCase() === workspaceId.toLowerCase())?.id
          : undefined
        item.command.run({ workspaceId: wsArg })
        if (!keepOpen) closePalette()
        return
      }

      if (item.kind === 'workspace') {
        // Compose: auto-complete the input to `@<name> ` and keep palette open
        // so the user can chain a secondary filter like `:idle`, `#team`, or tile search.
        // To actually switch workspace, use the `>switch to <name>` command instead.
        setInput(`@${item.workspace.name} `)
        setSelectedIndex(0)
        setTimeout(() => inputRef.current?.focus(), 0)
        return
      }

      // Scrollback
      jumpToScrollbackMatch(item.terminalId, item.lineNo)
      if (!keepOpen) closePalette()
    },
    [items, focusTile, closePalette, jumpToScrollbackMatch, parsed, workspaces, recordHistory]
  )

  const cyclePrefix = useCallback(() => {
    const currentIdx = PREFIX_CYCLE.indexOf(parsed.prefix)
    const nextIdx = (currentIdx + 1) % PREFIX_CYCLE.length
    const nextPrefix = PREFIX_CYCLE[nextIdx]
    // Strip existing prefix/arg from input, rebuild
    const termsOnly = parsed.terms
    const next = nextPrefix ? `${nextPrefix}${termsOnly}` : termsOnly
    setInput(next)
  }, [parsed])

  const insertPrefix = useCallback(
    (prefix: PalettePrefix) => {
      const termsOnly = parsed.terms
      setInput(`${prefix}${termsOnly}`)
      inputRef.current?.focus()
    },
    [parsed]
  )

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closePalette()
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        activate(selectedIndex, e.altKey)
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1))
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        // If the currently selected row is a workspace, Tab composes it into the input.
        const sel = items[selectedIndex]
        if (sel?.kind === 'workspace') {
          setInput(`@${sel.workspace.name} `)
          setSelectedIndex(0)
          setTimeout(() => inputRef.current?.focus(), 0)
          return
        }
        cyclePrefix()
        return
      }

      // Mod+1..9 quick-jump (palette-scoped, prevent globals)
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        const idx = parseInt(e.key, 10) - 1
        if (idx < items.length) activate(idx, e.altKey)
      }
    },
    [closePalette, activate, selectedIndex, items.length, cyclePrefix, input, activeWorkspaceId]
  )

  // Click-outside to close
  const handleBackdropMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePalette()
      }
    },
    [closePalette]
  )

  if (!paletteOpen) return null

  const tileTotalCount = corpus.length
  const shown = items.length

  const footer = (
    <PaletteFooter total={tileTotalCount} shown={shown} onInsertPrefix={insertPrefix} />
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-start justify-center bg-zinc-950/60 pt-[15vh] backdrop-blur-sm"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={containerRef}
        className="flex w-[640px] max-w-[90vw] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <PaletteInput
          ref={inputRef}
          value={input}
          parsed={parsed}
          onChange={setInput}
          onKeyDown={handleKeyDown}
        />
        <div className="max-h-[60vh] overflow-hidden">
          <PaletteList
            items={items}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onActivate={(i) => activate(i, false)}
          />
        </div>
        {footer}
      </div>
    </div>,
    document.body
  )
}

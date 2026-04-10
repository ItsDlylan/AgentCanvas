import { memo, useState, useEffect, useCallback, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { useAllTerminalStatuses, type TerminalStatus, type TerminalStatusInfo } from '@/hooks/useTerminalStatus'
import { useAllBrowserStatuses } from '@/hooks/useBrowserStatus'
import { registerRender } from '@/hooks/usePerformanceDebug'
import { useSettings, type WorkspaceTemplate } from '@/hooks/useSettings'
import { TERMINAL_PRESETS, BROWSER_SPAWN_PRESETS, type DevicePreset } from '@/constants/devicePresets'
import type { Workspace } from '@/types/workspace'

interface ProcessPanelProps {
  nodes: Node[]
  edges: Edge[]
  focusedId: string | null
  onFocus: (sessionId: string) => void
  onFocusProcess: (workspaceId: string, sessionId: string) => void
  onKill: (sessionId: string) => void
  onCloseNote: (sessionId: string) => void
  onDeleteNote: (sessionId: string) => void
  onAddTerminal: (width?: number, height?: number) => void
  onAddBrowser: (preset?: DevicePreset) => void
  onAddNote: () => void
  onAddDraw: () => void
  onCloseDraw: (sessionId: string) => void
  onDeleteDraw: (sessionId: string) => void
  onSpawnTemplate: (template: WorkspaceTemplate) => void
  open: boolean
  onToggle: () => void
  tileWorkspaceMap: Map<string, string>
  workspaces: Workspace[]
  activeWorkspaceId: string
  jumpHints: Map<string, string>
}

// ── Grouping types ──────────────────────────────────────

interface GroupChild {
  node: Node
  type: 'terminal' | 'browser' | 'notes' | 'diffViewer' | 'draw'
  sessionId: string
}

interface TileGroup {
  parentNode: Node
  parentSessionId: string
  parentType: 'terminal' | 'notes'
  children: GroupChild[]
}

interface GroupingResult {
  groups: TileGroup[]
  ungroupedTerminals: Node[]
  ungroupedBrowsers: Node[]
  ungroupedNotes: Node[]
  ungroupedDraws: Node[]
}

// ── Grouping logic ──────────────────────────────────────

function computeGroups(
  terminals: Node[],
  browsers: Node[],
  notes: Node[],
  diffViewers: Node[],
  draws: Node[],
  statuses: Map<string, TerminalStatusInfo>,
  edges: Edge[]
): GroupingResult {
  const terminalSessionIds = new Set(
    terminals.map((n) => (n.data as Record<string, unknown>).sessionId as string)
  )

  // Build a lookup from node.id -> node for all non-terminal tiles
  const nodeById = new Map<string, Node>()
  const nodeTypeById = new Map<string, 'terminal' | 'browser' | 'notes' | 'diffViewer' | 'draw'>()
  for (const n of terminals) { nodeById.set(n.id, n); nodeTypeById.set(n.id, 'terminal') }
  for (const n of browsers) { nodeById.set(n.id, n); nodeTypeById.set(n.id, 'browser') }
  for (const n of notes) { nodeById.set(n.id, n); nodeTypeById.set(n.id, 'notes') }
  for (const n of diffViewers) { nodeById.set(n.id, n); nodeTypeById.set(n.id, 'diffViewer') }
  for (const n of draws) { nodeById.set(n.id, n); nodeTypeById.set(n.id, 'draw') }

  // Map parent sessionId -> children
  const childrenMap = new Map<string, GroupChild[]>()
  const childSessionIds = new Set<string>()

  function addChild(parentSessionId: string, node: Node, type: 'terminal' | 'browser' | 'notes' | 'diffViewer', sessionId: string) {
    if (childSessionIds.has(sessionId)) return // already grouped
    const list = childrenMap.get(parentSessionId) || []
    list.push({ node, type, sessionId })
    childrenMap.set(parentSessionId, list)
    childSessionIds.add(sessionId)
  }

  // Child terminals (via metadata.parentTerminalId)
  const childTerminalIds = new Set<string>()
  for (const node of terminals) {
    const sessionId = (node.data as Record<string, unknown>).sessionId as string
    const info = statuses.get(sessionId)
    const parentId = info?.metadata?.parentTerminalId as string | undefined
    if (parentId && parentId !== sessionId && terminalSessionIds.has(parentId)) {
      addChild(parentId, node, 'terminal', sessionId)
      childTerminalIds.add(sessionId)
    }
  }

  // Linked browsers (via data.linkedTerminalId)
  for (const node of browsers) {
    const data = node.data as Record<string, unknown>
    const sessionId = data.sessionId as string
    const linkedId = data.linkedTerminalId as string | undefined
    if (linkedId && terminalSessionIds.has(linkedId)) {
      addChild(linkedId, node, 'browser', sessionId)
    }
  }

  // Linked notes (via data.linkedTerminalId)
  for (const node of notes) {
    const data = node.data as Record<string, unknown>
    const sessionId = data.sessionId as string
    const linkedId = data.linkedTerminalId as string | undefined
    if (linkedId && terminalSessionIds.has(linkedId)) {
      addChild(linkedId, node, 'notes', sessionId)
    }
  }

  // Linked diff viewers (via data.linkedTerminalId)
  for (const node of diffViewers) {
    const data = node.data as Record<string, unknown>
    const sessionId = data.sessionId as string
    const linkedId = data.linkedTerminalId as string | undefined
    if (linkedId && terminalSessionIds.has(linkedId)) {
      addChild(linkedId, node, 'diffViewer', sessionId)
    }
  }

  // Note-to-note groups (via data.linkedNoteId) — notes parented by other notes
  const noteSessionIds = new Set(
    notes.map((n) => (n.data as Record<string, unknown>).sessionId as string)
  )
  const childNoteIds = new Set<string>()
  for (const node of notes) {
    const data = node.data as Record<string, unknown>
    const sessionId = data.sessionId as string
    if (childSessionIds.has(sessionId)) continue // already grouped under a terminal
    const linkedNoteId = data.linkedNoteId as string | undefined
    if (linkedNoteId && linkedNoteId !== sessionId && noteSessionIds.has(linkedNoteId)) {
      addChild(linkedNoteId, node, 'notes', sessionId)
      childNoteIds.add(sessionId)
    }
  }

  // Edge-based grouping: any edge connecting a terminal to another tile
  for (const edge of edges) {
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    if (!sourceNode || !targetNode) continue

    const sourceType = nodeTypeById.get(edge.source)
    const targetType = nodeTypeById.get(edge.target)

    // terminal -> other tile
    if (sourceType === 'terminal' && targetType && targetType !== 'terminal') {
      const parentSid = (sourceNode.data as Record<string, unknown>).sessionId as string
      const childSid = (targetNode.data as Record<string, unknown>).sessionId as string
      if (terminalSessionIds.has(parentSid)) {
        addChild(parentSid, targetNode, targetType, childSid)
      }
    }
    // other tile -> terminal
    else if (targetType === 'terminal' && sourceType && sourceType !== 'terminal') {
      const parentSid = (targetNode.data as Record<string, unknown>).sessionId as string
      const childSid = (sourceNode.data as Record<string, unknown>).sessionId as string
      if (terminalSessionIds.has(parentSid)) {
        addChild(parentSid, sourceNode, sourceType, childSid)
      }
    }
    // terminal -> terminal (edge-based, not metadata)
    else if (sourceType === 'terminal' && targetType === 'terminal') {
      const sourceSid = (sourceNode.data as Record<string, unknown>).sessionId as string
      const targetSid = (targetNode.data as Record<string, unknown>).sessionId as string
      // Source is the parent (connection origin)
      if (terminalSessionIds.has(sourceSid) && !childTerminalIds.has(targetSid)) {
        addChild(sourceSid, targetNode, 'terminal', targetSid)
        childTerminalIds.add(targetSid)
      }
    }
  }

  // Second pass: propagate group membership through non-terminal edges.
  // If a note is already grouped under a terminal and has an edge to another note,
  // that other note joins the same group.
  // Build a reverse lookup: childSessionId -> parentSessionId
  const childToParent = new Map<string, string>()
  for (const [parentSid, children] of childrenMap) {
    for (const child of children) {
      childToParent.set(child.sessionId, parentSid)
    }
  }

  // Keep propagating until no new children are added
  let changed = true
  while (changed) {
    changed = false
    for (const edge of edges) {
      const sourceNode = nodeById.get(edge.source)
      const targetNode = nodeById.get(edge.target)
      if (!sourceNode || !targetNode) continue

      const sourceSid = (sourceNode.data as Record<string, unknown>).sessionId as string
      const targetSid = (targetNode.data as Record<string, unknown>).sessionId as string
      const sourceType = nodeTypeById.get(edge.source)!
      const targetType = nodeTypeById.get(edge.target)!

      // Skip if both are terminals (already handled above)
      if (sourceType === 'terminal' && targetType === 'terminal') continue

      // If source is grouped and target is not, add target to same group
      const sourceParent = childToParent.get(sourceSid)
      const targetParent = childToParent.get(targetSid)

      const isGroupParent = (sid: string) => terminalSessionIds.has(sid) || childrenMap.has(sid)

      if (sourceParent && !childSessionIds.has(targetSid) && !isGroupParent(targetSid)) {
        addChild(sourceParent, targetNode, targetType, targetSid)
        childToParent.set(targetSid, sourceParent)
        changed = true
      } else if (targetParent && !childSessionIds.has(sourceSid) && !isGroupParent(sourceSid)) {
        addChild(targetParent, sourceNode, sourceType, sourceSid)
        childToParent.set(sourceSid, targetParent)
        changed = true
      }
    }
  }

  const groups: TileGroup[] = []
  const ungroupedTerminals: Node[] = []
  const groupedBrowserIds = new Set<string>()
  const groupedNoteIds = new Set<string>()

  // Terminal-parented groups
  for (const node of terminals) {
    const sessionId = (node.data as Record<string, unknown>).sessionId as string
    if (childTerminalIds.has(sessionId)) continue

    const children = childrenMap.get(sessionId)
    if (children && children.length > 0) {
      groups.push({ parentNode: node, parentSessionId: sessionId, parentType: 'terminal', children })
      for (const child of children) {
        if (child.type === 'browser') groupedBrowserIds.add(child.sessionId)
        if (child.type === 'notes') groupedNoteIds.add(child.sessionId)
      }
    } else {
      ungroupedTerminals.push(node)
    }
  }

  // Note-parented groups
  for (const node of notes) {
    const sessionId = (node.data as Record<string, unknown>).sessionId as string
    if (groupedNoteIds.has(sessionId) || childNoteIds.has(sessionId) || childSessionIds.has(sessionId)) continue

    const children = childrenMap.get(sessionId)
    if (children && children.length > 0) {
      groups.push({ parentNode: node, parentSessionId: sessionId, parentType: 'notes', children })
      groupedNoteIds.add(sessionId) // parent note is also "grouped"
      for (const child of children) {
        if (child.type === 'notes') groupedNoteIds.add(child.sessionId)
        if (child.type === 'browser') groupedBrowserIds.add(child.sessionId)
      }
    }
  }

  const ungroupedBrowsers = browsers.filter((n) => {
    const sid = (n.data as Record<string, unknown>).sessionId as string
    return !groupedBrowserIds.has(sid)
  })

  const ungroupedNotes = notes.filter((n) => {
    const sid = (n.data as Record<string, unknown>).sessionId as string
    return !groupedNoteIds.has(sid) && !childNoteIds.has(sid)
  })

  const ungroupedDraws = draws.filter((n) => {
    const sid = (n.data as Record<string, unknown>).sessionId as string
    return !childSessionIds.has(sid)
  })

  return { groups, ungroupedTerminals, ungroupedBrowsers, ungroupedNotes, ungroupedDraws }
}

// ── Shared components ───────────────────────────────────

function JumpBadge({ hint }: { hint: string | undefined }) {
  if (!hint) return null
  return (
    <span className="ml-auto shrink-0 rounded border border-blue-400/50 bg-blue-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-blue-300">
      {hint}
    </span>
  )
}

const STATUS_CONFIG: Record<TerminalStatus, { dot: string; label: string; labelColor: string }> = {
  idle: { dot: 'bg-zinc-500', label: 'Idle', labelColor: 'text-zinc-600' },
  running: { dot: 'bg-green-500', label: 'Running', labelColor: 'text-green-500/70' },
  waiting: { dot: 'bg-amber-400 animate-pulse', label: 'Waiting', labelColor: 'text-amber-400/70' }
}

function shortenPath(path: string): string {
  const home = path.replace(/^\/Users\/[^/]+/, '~')
  const parts = home.split('/')
  if (parts.length <= 3) return home
  return parts[0] + '/.../' + parts.slice(-2).join('/')
}

function CloseButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-0.5 shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-red-400 group-hover:opacity-100"
    >
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  )
}

// ── Entry sub-components ────────────────────────────────

interface TerminalEntryProps {
  node: Node
  focusedId: string | null
  statuses: Map<string, TerminalStatusInfo>
  jumpHints: Map<string, string>
  onFocus: (sessionId: string) => void
  onKill: (sessionId: string) => void
  compact?: boolean
}

function TerminalEntry({ node, focusedId, statuses, jumpHints, onFocus, onKill, compact }: TerminalEntryProps) {
  const data = node.data as Record<string, unknown>
  const sessionId = data.sessionId as string
  const label = data.label as string
  const isFocused = focusedId === sessionId
  const info = statuses.get(sessionId)
  const status = info?.status ?? 'running'
  const cwd = info?.cwd
  const foreground = info?.foregroundProcess
  const cfg = STATUS_CONFIG[status]

  return (
    <button
      onClick={() => onFocus(sessionId)}
      className={`group flex w-full items-start gap-2.5 rounded-md px-2.5 ${compact ? 'py-1.5' : 'py-2'} text-left transition-colors ${
        isFocused
          ? 'bg-blue-500/10 ring-1 ring-blue-500/20'
          : 'hover:bg-zinc-800'
      }`}
    >
      <span
        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : cfg.dot}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate text-xs font-medium ${
              isFocused ? 'text-blue-300' : 'text-zinc-300'
            }`}
          >
            {label}
          </span>
          <span className={`shrink-0 text-[10px] ${cfg.labelColor}`}>
            {cfg.label}
          </span>
        </div>
        {cwd && (
          <span className="truncate text-[10px] text-zinc-600" title={cwd}>
            {shortenPath(cwd)}
          </span>
        )}
        {foreground && !['zsh', 'bash', 'fish', 'sh'].includes(foreground) && (
          <span className="truncate text-[10px] text-zinc-500">
            {foreground}
          </span>
        )}
      </div>
      <JumpBadge hint={jumpHints.get(sessionId)} />
      <CloseButton onClick={(e) => { e.stopPropagation(); onKill(sessionId) }} />
    </button>
  )
}

interface BrowserEntryProps {
  node: Node
  focusedId: string | null
  browserStatuses: Map<string, { title?: string; url?: string; loading?: boolean }>
  jumpHints: Map<string, string>
  tileWorkspaceMap: Map<string, string>
  workspaces: Workspace[]
  activeWorkspaceId: string
  onFocus: (sessionId: string) => void
  onFocusProcess: (workspaceId: string, sessionId: string) => void
  onKill: (sessionId: string) => void
  isBackground?: boolean
  compact?: boolean
}

function BrowserEntry({
  node, focusedId, browserStatuses, jumpHints, tileWorkspaceMap, workspaces,
  activeWorkspaceId, onFocus, onFocusProcess, onKill, isBackground, compact
}: BrowserEntryProps) {
  const data = node.data as Record<string, unknown>
  const sessionId = data.sessionId as string
  const label = data.label as string
  const isFocused = focusedId === sessionId
  const info = browserStatuses.get(sessionId)
  const isLoading = info?.loading ?? true
  const title = info?.title || label
  const url = info?.url
  const wsId = tileWorkspaceMap.get(sessionId)
  const ws = isBackground ? workspaces.find((w) => w.id === wsId) : undefined

  return (
    <button
      onClick={() => {
        if (wsId && wsId !== activeWorkspaceId) {
          onFocusProcess(wsId, sessionId)
        } else {
          onFocus(sessionId)
        }
      }}
      className={`group flex w-full items-start gap-2.5 rounded-md px-2.5 ${compact ? 'py-1.5' : 'py-2'} text-left transition-colors ${
        isFocused
          ? 'bg-blue-500/10 ring-1 ring-blue-500/20'
          : isBackground
            ? 'opacity-60 hover:bg-zinc-800 hover:opacity-100'
            : 'hover:bg-zinc-800'
      }`}
    >
      <span
        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
          isFocused ? 'bg-blue-400' : isLoading ? 'bg-blue-400 animate-pulse' : 'bg-emerald-500'
        }`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate text-xs font-medium ${
              isFocused ? 'text-blue-300' : 'text-zinc-300'
            }`}
          >
            {title}
          </span>
          <span className="shrink-0 text-[10px] text-emerald-500/70">
            Browser
          </span>
        </div>
        {url && (
          <span className="truncate text-[10px] text-zinc-500" title={url}>
            {url.replace(/^https?:\/\//, '')}
          </span>
        )}
        {ws && (
          <span className="truncate text-[10px] text-purple-400/70">
            {ws.name}
          </span>
        )}
      </div>
      <JumpBadge hint={jumpHints.get(sessionId)} />
      <CloseButton onClick={(e) => { e.stopPropagation(); onKill(sessionId) }} />
    </button>
  )
}

interface NoteEntryProps {
  node: Node
  focusedId: string | null
  jumpHints: Map<string, string>
  onFocus: (sessionId: string) => void
  onCloseNote: (sessionId: string) => void
  onDeleteNote: (sessionId: string) => void
  compact?: boolean
}

function NoteEntry({ node, focusedId, jumpHints, onFocus, onCloseNote, onDeleteNote, compact }: NoteEntryProps) {
  const data = node.data as Record<string, unknown>
  const sessionId = data.sessionId as string
  const label = data.label as string
  const isFocused = focusedId === sessionId

  return (
    <button
      onClick={() => onFocus(sessionId)}
      className={`group flex w-full items-start gap-2.5 rounded-md px-2.5 ${compact ? 'py-1.5' : 'py-2'} text-left transition-colors ${
        isFocused
          ? 'bg-blue-500/10 ring-1 ring-blue-500/20'
          : 'hover:bg-zinc-800'
      }`}
    >
      <span
        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : 'bg-amber-400'}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate text-xs font-medium ${
              isFocused ? 'text-blue-300' : 'text-zinc-300'
            }`}
          >
            {label}
          </span>
          <span className="shrink-0 text-[10px] text-amber-400/70">
            Note
          </span>
        </div>
      </div>
      <JumpBadge hint={jumpHints.get(sessionId)} />
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onCloseNote(sessionId) }}
          className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
          title="Close (keep file)"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDeleteNote(sessionId) }}
          className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-red-400"
          title="Delete permanently"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </button>
  )
}

interface DiffViewerEntryProps {
  node: Node
  focusedId: string | null
  jumpHints: Map<string, string>
  onFocus: (sessionId: string) => void
  onKill: (sessionId: string) => void
  compact?: boolean
}

function DiffViewerEntry({ node, focusedId, jumpHints, onFocus, onKill, compact }: DiffViewerEntryProps) {
  const data = node.data as Record<string, unknown>
  const sessionId = data.sessionId as string
  const label = (data.label as string) || 'Diff Viewer'
  const isFocused = focusedId === sessionId

  return (
    <button
      onClick={() => onFocus(sessionId)}
      className={`group flex w-full items-start gap-2.5 rounded-md px-2.5 ${compact ? 'py-1.5' : 'py-2'} text-left transition-colors ${
        isFocused
          ? 'bg-blue-500/10 ring-1 ring-blue-500/20'
          : 'hover:bg-zinc-800'
      }`}
    >
      <span
        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : 'bg-purple-400'}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate text-xs font-medium ${
              isFocused ? 'text-blue-300' : 'text-zinc-300'
            }`}
          >
            {label}
          </span>
          <span className="shrink-0 text-[10px] text-purple-400/70">
            Diff
          </span>
        </div>
      </div>
      <JumpBadge hint={jumpHints.get(sessionId)} />
      <CloseButton onClick={(e) => { e.stopPropagation(); onKill(sessionId) }} />
    </button>
  )
}

// ── Group components ────────────────────────────────────

interface GroupChildEntryProps {
  child: GroupChild
  isLast: boolean
  focusedId: string | null
  statuses: Map<string, TerminalStatusInfo>
  browserStatuses: Map<string, { title?: string; url?: string; loading?: boolean }>
  jumpHints: Map<string, string>
  tileWorkspaceMap: Map<string, string>
  workspaces: Workspace[]
  activeWorkspaceId: string
  onFocus: (sessionId: string) => void
  onFocusProcess: (workspaceId: string, sessionId: string) => void
  onKill: (sessionId: string) => void
  onCloseNote: (sessionId: string) => void
  onDeleteNote: (sessionId: string) => void
}

function GroupChildEntry({
  child, isLast, focusedId, statuses, browserStatuses, jumpHints,
  tileWorkspaceMap, workspaces, activeWorkspaceId,
  onFocus, onFocusProcess, onKill, onCloseNote, onDeleteNote
}: GroupChildEntryProps) {
  return (
    <div className={`ml-3 ${isLast ? '' : 'border-l border-zinc-700/50'}`}>
      <div className="ml-1">
        {child.type === 'terminal' && (
          <TerminalEntry
            node={child.node}
            focusedId={focusedId}
            statuses={statuses}
            jumpHints={jumpHints}
            onFocus={onFocus}
            onKill={onKill}
            compact
          />
        )}
        {child.type === 'browser' && (
          <BrowserEntry
            node={child.node}
            focusedId={focusedId}
            browserStatuses={browserStatuses}
            jumpHints={jumpHints}
            tileWorkspaceMap={tileWorkspaceMap}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            onFocus={onFocus}
            onFocusProcess={onFocusProcess}
            onKill={onKill}
            compact
          />
        )}
        {child.type === 'notes' && (
          <NoteEntry
            node={child.node}
            focusedId={focusedId}
            jumpHints={jumpHints}
            onFocus={onFocus}
            onCloseNote={onCloseNote}
            onDeleteNote={onDeleteNote}
            compact
          />
        )}
        {child.type === 'diffViewer' && (
          <DiffViewerEntry
            node={child.node}
            focusedId={focusedId}
            jumpHints={jumpHints}
            onFocus={onFocus}
            onKill={onKill}
            compact
          />
        )}
      </div>
    </div>
  )
}

interface ProcessGroupProps {
  group: TileGroup
  isExpanded: boolean
  onToggleExpand: () => void
  focusedId: string | null
  statuses: Map<string, TerminalStatusInfo>
  browserStatuses: Map<string, { title?: string; url?: string; loading?: boolean }>
  jumpHints: Map<string, string>
  tileWorkspaceMap: Map<string, string>
  workspaces: Workspace[]
  activeWorkspaceId: string
  onFocus: (sessionId: string) => void
  onFocusProcess: (workspaceId: string, sessionId: string) => void
  onKill: (sessionId: string) => void
  onCloseNote: (sessionId: string) => void
  onDeleteNote: (sessionId: string) => void
}

function ProcessGroup({
  group, isExpanded, onToggleExpand, focusedId, statuses, browserStatuses,
  jumpHints, tileWorkspaceMap, workspaces, activeWorkspaceId,
  onFocus, onFocusProcess, onKill, onCloseNote, onDeleteNote
}: ProcessGroupProps) {
  const data = group.parentNode.data as Record<string, unknown>
  const sessionId = data.sessionId as string
  const label = data.label as string
  const isFocused = focusedId === sessionId
  const isTerminalParent = group.parentType === 'terminal'

  // Terminal-specific status info
  const info = isTerminalParent ? statuses.get(sessionId) : undefined
  const status = info?.status ?? 'running'
  const cwd = info?.cwd
  const foreground = info?.foregroundProcess
  const cfg = STATUS_CONFIG[status]

  // Check if any child is focused (for subtle parent highlight)
  const childHasFocus = group.children.some((c) => focusedId === c.sessionId)

  const chevron = (
    <button
      onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
      className="mt-0.5 shrink-0 rounded p-0.5 text-zinc-500 hover:text-zinc-300"
    >
      <svg
        className={`h-3 w-3 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )

  const countBadge = (
    <span className="shrink-0 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
      {group.children.length}
    </span>
  )

  const headerClass = `group flex w-full items-start gap-1.5 rounded-md px-1.5 py-2 text-left transition-colors ${
    isFocused
      ? 'bg-blue-500/10 ring-1 ring-blue-500/20'
      : childHasFocus
        ? 'bg-zinc-800/50'
        : 'hover:bg-zinc-800'
  }`

  return (
    <div>
      {/* Group header */}
      <button onClick={() => onFocus(sessionId)} className={headerClass}>
        {chevron}

        {isTerminalParent ? (
          <>
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : cfg.dot}`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className={`truncate text-xs font-medium ${isFocused ? 'text-blue-300' : 'text-zinc-300'}`}>
                  {label}
                </span>
                <span className={`shrink-0 text-[10px] ${cfg.labelColor}`}>{cfg.label}</span>
                {countBadge}
              </div>
              {cwd && (
                <span className="truncate text-[10px] text-zinc-600" title={cwd}>
                  {shortenPath(cwd)}
                </span>
              )}
              {foreground && !['zsh', 'bash', 'fish', 'sh'].includes(foreground) && (
                <span className="truncate text-[10px] text-zinc-500">{foreground}</span>
              )}
            </div>
            <JumpBadge hint={jumpHints.get(sessionId)} />
            <CloseButton onClick={(e) => { e.stopPropagation(); onKill(sessionId) }} />
          </>
        ) : (
          <>
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : 'bg-amber-400'}`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className={`truncate text-xs font-medium ${isFocused ? 'text-blue-300' : 'text-zinc-300'}`}>
                  {label}
                </span>
                <span className="shrink-0 text-[10px] text-amber-400/70">Note</span>
                {countBadge}
              </div>
            </div>
            <JumpBadge hint={jumpHints.get(sessionId)} />
            <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={(e) => { e.stopPropagation(); onCloseNote(sessionId) }}
                className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
                title="Close (keep file)"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteNote(sessionId) }}
                className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-red-400"
                title="Delete permanently"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </>
        )}
      </button>

      {/* Children */}
      {isExpanded && (
        <div className="ml-2">
          {group.children.map((child, i) => (
            <GroupChildEntry
              key={child.sessionId}
              child={child}
              isLast={i === group.children.length - 1}
              focusedId={focusedId}
              statuses={statuses}
              browserStatuses={browserStatuses}
              jumpHints={jumpHints}
              tileWorkspaceMap={tileWorkspaceMap}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onFocus={onFocus}
              onFocusProcess={onFocusProcess}
              onKill={onKill}
              onCloseNote={onCloseNote}
              onDeleteNote={onDeleteNote}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ──────────────────────────────────────

function ProcessPanelComponent({
  nodes,
  edges,
  focusedId,
  onFocus,
  onFocusProcess,
  onKill,
  onCloseNote,
  onDeleteNote,
  onAddTerminal,
  onAddBrowser,
  onAddNote,
  onAddDraw,
  onCloseDraw,
  onDeleteDraw,
  onSpawnTemplate,
  open,
  onToggle,
  tileWorkspaceMap,
  workspaces,
  activeWorkspaceId,
  jumpHints
}: ProcessPanelProps) {
  registerRender('ProcessPanel')
  const terminals = nodes.filter((n) => n.type === 'terminal')
  const allBrowsers = nodes.filter((n) => n.type === 'browser')
  const notes = nodes.filter((n) => n.type === 'notes')
  const diffViewers = nodes.filter((n) => n.type === 'diffViewer')
  const draws = nodes.filter((n) => n.type === 'draw')
  const browsers = allBrowsers.filter((n) => {
    const sid = (n.data as Record<string, unknown>).sessionId as string
    return tileWorkspaceMap.get(sid) === activeWorkspaceId
  })
  const backgroundBrowsers = allBrowsers.filter((n) => {
    const sid = (n.data as Record<string, unknown>).sessionId as string
    return tileWorkspaceMap.get(sid) !== activeWorkspaceId
  })
  const statuses = useAllTerminalStatuses()
  const browserStatuses = useAllBrowserStatuses()
  const [terminalPresetsOpen, setTerminalPresetsOpen] = useState(false)
  const [browserPresetsOpen, setBrowserPresetsOpen] = useState(false)
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const { settings } = useSettings()

  const toggleGroup = useCallback((parentId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }, [])

  // Compute tile groups
  const grouping = useMemo(
    () => computeGroups(terminals, browsers, notes, diffViewers, draws, statuses, edges),
    [terminals, browsers, notes, diffViewers, draws, statuses, edges]
  )

  useEffect(() => {
    if (!terminalPresetsOpen && !browserPresetsOpen && !templateMenuOpen) return
    const handler = () => {
      setTerminalPresetsOpen(false)
      setBrowserPresetsOpen(false)
      setTemplateMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [terminalPresetsOpen, browserPresetsOpen, templateMenuOpen])

  return (
    <>
      {/* Toggle pill on the edge */}
      <button
        onClick={onToggle}
        className="absolute top-1/2 z-20 flex -translate-y-1/2 items-center rounded-l-full border border-r-0 border-zinc-700 bg-zinc-800 px-1.5 py-4 text-zinc-500 transition-all hover:bg-zinc-700 hover:text-zinc-200"
        style={{ right: open ? 256 : 0 }}
      >
        <svg
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Panel */}
      <div
        className="absolute right-0 top-0 z-10 flex h-full flex-col border-l border-zinc-800 bg-zinc-900"
        style={{
          width: 256,
          transform: open ? 'translateX(0)' : 'translateX(100%)'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Processes
          </span>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
            {terminals.length + allBrowsers.length + notes.length}
          </span>
        </div>

        {/* Process list */}
        <div className="flex-1 overflow-y-auto p-2">
          {terminals.length === 0 && allBrowsers.length === 0 && notes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="text-xs text-zinc-600">No active tiles</span>
            </div>
          ) : (
            <>
            <div className="flex flex-col gap-1">
              {/* Grouped entries */}
              {grouping.groups.map((group) => (
                <ProcessGroup
                  key={group.parentSessionId}
                  group={group}
                  isExpanded={!collapsedGroups.has(group.parentSessionId)}
                  onToggleExpand={() => toggleGroup(group.parentSessionId)}
                  focusedId={focusedId}
                  statuses={statuses}
                  browserStatuses={browserStatuses}
                  jumpHints={jumpHints}
                  tileWorkspaceMap={tileWorkspaceMap}
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  onFocus={onFocus}
                  onFocusProcess={onFocusProcess}
                  onKill={onKill}
                  onCloseNote={onCloseNote}
                  onDeleteNote={onDeleteNote}
                />
              ))}

              {/* Ungrouped terminals */}
              {grouping.ungroupedTerminals.map((node) => (
                <TerminalEntry
                  key={node.id}
                  node={node}
                  focusedId={focusedId}
                  statuses={statuses}
                  jumpHints={jumpHints}
                  onFocus={onFocus}
                  onKill={onKill}
                />
              ))}

              {/* Ungrouped browsers (current workspace) */}
              {grouping.ungroupedBrowsers.map((node) => (
                <BrowserEntry
                  key={node.id}
                  node={node}
                  focusedId={focusedId}
                  browserStatuses={browserStatuses}
                  jumpHints={jumpHints}
                  tileWorkspaceMap={tileWorkspaceMap}
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  onFocus={onFocus}
                  onFocusProcess={onFocusProcess}
                  onKill={onKill}
                />
              ))}

              {/* Ungrouped notes */}
              {grouping.ungroupedNotes.map((node) => (
                <NoteEntry
                  key={node.id}
                  node={node}
                  focusedId={focusedId}
                  jumpHints={jumpHints}
                  onFocus={onFocus}
                  onCloseNote={onCloseNote}
                  onDeleteNote={onDeleteNote}
                />
              ))}

              {/* Ungrouped draws */}
              {grouping.ungroupedDraws.map((node) => {
                const data = node.data as Record<string, unknown>
                const sessionId = data.sessionId as string
                const label = (data.label as string) || 'Draw'
                const isFocused = focusedId === sessionId
                return (
                  <button
                    key={node.id}
                    onClick={() => onFocus(sessionId)}
                    className={`group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                      isFocused ? 'bg-pink-500/10 text-pink-300' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${isFocused ? 'bg-pink-400' : 'bg-zinc-600'}`} />
                    <div className="flex flex-1 min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs">{label}</span>
                      <span className="shrink-0 text-[10px] text-pink-400/70">Draw</span>
                    </div>
                    <JumpBadge hint={jumpHints.get(sessionId)} />
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); onCloseDraw(sessionId) }}
                        className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
                        title="Close (keep file)"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteDraw(sessionId) }}
                        className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-red-400"
                        title="Delete permanently"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Background browsers from other workspaces */}
            {backgroundBrowsers.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center gap-2 px-2.5 pb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                    Other Workspaces
                  </span>
                  <span className="rounded-full bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    {backgroundBrowsers.length}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {backgroundBrowsers.map((node) => (
                    <BrowserEntry
                      key={node.id}
                      node={node}
                      focusedId={focusedId}
                      browserStatuses={browserStatuses}
                      jumpHints={jumpHints}
                      tileWorkspaceMap={tileWorkspaceMap}
                      workspaces={workspaces}
                      activeWorkspaceId={activeWorkspaceId}
                      onFocus={onFocus}
                      onFocusProcess={onFocusProcess}
                      onKill={onKill}
                      isBackground
                    />
                  ))}
                </div>
              </div>
            )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap gap-1.5 border-t border-zinc-800 p-2">
          {/* Terminal split button */}
          <div className="relative flex-1" onMouseDown={(e) => e.stopPropagation()}>
            {terminalPresetsOpen && (
              <div className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
                {TERMINAL_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => {
                      onAddTerminal(preset.width, preset.height)
                      setTerminalPresetsOpen(false)
                    }}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                  >
                    <span>{preset.name}</span>
                    <span className="text-zinc-500">{preset.width}&times;{preset.height}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex overflow-hidden rounded-md bg-zinc-800">
              <button
                onClick={() => onAddTerminal()}
                className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Terminal
              </button>
              <button
                onClick={() => setTerminalPresetsOpen(!terminalPresetsOpen)}
                className="border-l border-zinc-700 px-1.5 py-2 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Browser split button */}
          <div className="relative flex-1" onMouseDown={(e) => e.stopPropagation()}>
            {browserPresetsOpen && (
              <div className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
                {BROWSER_SPAWN_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => {
                      onAddBrowser(preset)
                      setBrowserPresetsOpen(false)
                    }}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                  >
                    <span>{preset.name}</span>
                    <span className="text-zinc-500">{preset.width}&times;{preset.height}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex overflow-hidden rounded-md bg-zinc-800">
              <button
                onClick={() => onAddBrowser()}
                className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium text-emerald-400 transition-colors hover:bg-zinc-700 hover:text-emerald-300"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Browser
              </button>
              <button
                onClick={() => setBrowserPresetsOpen(!browserPresetsOpen)}
                className="border-l border-zinc-700 px-1.5 py-2 text-emerald-400 transition-colors hover:bg-zinc-700 hover:text-emerald-300"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Note button */}
          <button
            onClick={() => onAddNote()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-zinc-800 py-2 text-xs font-medium text-amber-400 transition-colors hover:bg-zinc-700 hover:text-amber-300"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Note
          </button>

          {/* Draw button */}
          <button
            onClick={() => onAddDraw()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-zinc-800 py-2 text-xs font-medium text-pink-400 transition-colors hover:bg-zinc-700 hover:text-pink-300"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Draw
          </button>

          {/* Template button */}
          {settings.templates.length > 0 && (
            <div className="relative w-full" onMouseDown={(e) => e.stopPropagation()}>
              {templateMenuOpen && (
                <div className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
                  {settings.templates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      onClick={() => {
                        onSpawnTemplate(tmpl)
                        setTemplateMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                      <span className="flex-1">{tmpl.name}</span>
                      <span className="text-zinc-600">{tmpl.tiles.length} tiles</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setTemplateMenuOpen(!templateMenuOpen)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-800 py-2 text-xs font-medium text-blue-400 transition-colors hover:bg-zinc-700 hover:text-blue-300"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm10 0a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
                </svg>
                Template
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export const ProcessPanel = memo(ProcessPanelComponent)

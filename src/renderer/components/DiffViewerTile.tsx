import { memo, useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import { DiffFile } from '@git-diff-view/file'
import { useFocusedTerminal } from '@/hooks/useFocusedTerminal'
import { useTerminalStatus } from '@/hooks/useTerminalStatus'
import { useIsPanning, isPanningNow } from '@/hooks/usePanState'
import { useDiff, type DiffFileChange } from '@/hooks/useDiff'
import '@git-diff-view/react/styles/diff-view.css'
import { EditableLabel } from './EditableLabel'

export interface DiffViewerNodeData {
  sessionId: string
  label: string
  linkedTerminalId: string
  cwd: string
  onClose?: (sessionId: string) => void
}

const CHANGE_KIND_CONFIG: Record<string, { letter: string; color: string; bg: string }> = {
  added: { letter: 'A', color: 'text-green-400', bg: 'bg-green-500/20' },
  deleted: { letter: 'D', color: 'text-red-400', bg: 'bg-red-500/20' },
  modified: { letter: 'M', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  renamed: { letter: 'R', color: 'text-blue-400', bg: 'bg-blue-500/20' }
}

function getFileLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    css: 'css', html: 'html', json: 'json', md: 'markdown',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'bash',
    sql: 'sql', rb: 'ruby', php: 'php', swift: 'swift',
    kt: 'kotlin', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp'
  }
  return langMap[ext] || ext
}

function fileName(path: string): string {
  return path.split('/').pop() || path
}

function filePath(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/') + '/'
}

function DiffViewerTileComponent({ data, width, height }: NodeProps) {
  const {
    sessionId,
    label,
    linkedTerminalId,
    cwd: initialCwd,
    onClose
  } = data as unknown as DiffViewerNodeData

  const { focusedId, setFocusedId, renameTile } = useFocusedTerminal()
  const isPanning = useIsPanning()
  const isFocused = focusedId === sessionId
  const resizingRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)
  const bodyElRef = useRef<HTMLDivElement | null>(null)

  // Get CWD from linked terminal's live status.
  // The diff service resolves to git toplevel automatically, so the terminal's
  // live CWD is sufficient even if it's a subdirectory of the repo/worktree.
  const terminalStatus = useTerminalStatus(linkedTerminalId)
  const cwd = terminalStatus?.cwd || initialCwd || undefined

  const { data: diffData, loading, error, refresh, selectedFile, selectFile, viewMode, setViewMode } = useDiff({ cwd })

  const handleFocus = useCallback(() => setFocusedId(sessionId), [setFocusedId, sessionId])

  const onResizeStart = useCallback(() => {
    resizingRef.current = true
    setIsResizing(true)
  }, [])

  const onResizeEnd = useCallback(() => {
    resizingRef.current = false
    setIsResizing(false)
  }, [])

  // Prevent canvas pan while scrolling inside the tile
  useEffect(() => {
    const el = bodyElRef.current
    if (!el || !isFocused) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) e.stopPropagation()
    }
    el.addEventListener('wheel', handler)
    return () => el.removeEventListener('wheel', handler)
  }, [isFocused])

  const selectedDiff = useMemo(() => {
    if (!selectedFile || !diffData) return null
    return diffData.files.find((f) => f.newPath === selectedFile) || null
  }, [selectedFile, diffData])

  const diffFileInstance = useMemo(() => {
    if (!selectedDiff || !selectedDiff.rawDiff) return null
    try {
      // The library expects each entry in hunks[] to be a complete unified diff
      // (with diff --git header), not individual @@ chunks
      const instance = DiffFile.createInstance({
        oldFile: {
          fileName: selectedDiff.oldPath,
          fileLang: getFileLang(selectedDiff.oldPath),
          content: null
        },
        newFile: {
          fileName: selectedDiff.newPath,
          fileLang: getFileLang(selectedDiff.newPath),
          content: null
        },
        hunks: [selectedDiff.rawDiff]
      })
      instance.init()
      instance.buildSplitDiffLines()
      instance.buildUnifiedDiffLines()
      return instance
    } catch (err) {
      console.error('[DiffViewer] Failed to parse diff:', err)
      return null
    }
  }, [selectedDiff])

  return (
    <div
      className={`diff-viewer-tile ${
        isFocused
          ? 'ring-1 ring-purple-500/60 shadow-[0_0_20px_rgba(168,85,247,0.15)]'
          : ''
      }`}
      style={{ width: '100%', height: '100%', pointerEvents: isPanning ? 'none' : 'auto' }}
      onMouseDown={handleFocus}
    >
      <NodeResizer
        minWidth={400}
        minHeight={250}
        isVisible={isFocused}
        color="#a855f7"
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />

      {isResizing && width != null && height != null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <span className="rounded bg-black/80 px-2 py-1 text-xs font-mono text-zinc-300">
            {Math.round(width)} x {Math.round(height)}
          </span>
        </div>
      )}

      {/* Header */}
      <div className={`diff-viewer-tile-header ${isFocused ? 'border-b-purple-500/30' : ''}`}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${isFocused ? 'bg-purple-400' : 'bg-purple-500/60'}`} />
          <EditableLabel
            label={label}
            onRename={(newLabel) => renameTile(sessionId, newLabel)}
            className={`text-xs font-medium ${isFocused ? 'text-zinc-200' : 'text-zinc-400'}`}
          />
          {diffData?.branch && (
            <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-400">
              {diffData.branch}
            </span>
          )}
          {diffData && (
            <span className="text-[10px] text-zinc-600">
              {diffData.summary.filesChanged} file{diffData.summary.filesChanged !== 1 ? 's' : ''}
              {diffData.summary.additions > 0 && <span className="text-green-500/70"> +{diffData.summary.additions}</span>}
              {diffData.summary.deletions > 0 && <span className="text-red-500/70"> -{diffData.summary.deletions}</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* View mode toggle */}
          <button
            className={`titlebar-no-drag rounded px-1.5 py-0.5 text-[10px] ${
              viewMode === 'split' ? 'bg-purple-500/20 text-purple-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            onClick={() => setViewMode('split')}
          >
            Split
          </button>
          <button
            className={`titlebar-no-drag rounded px-1.5 py-0.5 text-[10px] ${
              viewMode === 'unified' ? 'bg-purple-500/20 text-purple-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            onClick={() => setViewMode('unified')}
          >
            Unified
          </button>
          {/* Refresh */}
          <button
            className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            onClick={refresh}
            title="Refresh diff"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          {/* Close */}
          <button
            className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            onClick={() => onClose?.(sessionId)}
          >
            Close
          </button>
        </div>
      </div>

      {/* Body */}
      <div ref={bodyElRef} className="diff-viewer-tile-body titlebar-no-drag" style={{ pointerEvents: isFocused ? 'auto' : 'none' }}>
        {/* File sidebar */}
        <div className="diff-viewer-tile-sidebar">
          {loading && (
            <div className="p-3 text-xs text-zinc-500">Loading...</div>
          )}
          {error && (
            <div className="p-3 text-xs text-red-400">{error}</div>
          )}
          {diffData && diffData.files.length === 0 && !loading && (
            <div className="p-3 text-xs text-zinc-500">No changes</div>
          )}
          {diffData?.files.map((file) => {
            const cfg = CHANGE_KIND_CONFIG[file.changeKind] || CHANGE_KIND_CONFIG.modified
            const isSelected = selectedFile === file.newPath
            return (
              <button
                key={file.newPath}
                className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] transition-colors ${
                  isSelected ? 'bg-purple-500/10 text-zinc-200' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
                }`}
                onClick={() => selectFile(file.newPath)}
                title={file.newPath}
              >
                <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${cfg.color} ${cfg.bg}`}>
                  {cfg.letter}
                </span>
                <span className="truncate">
                  <span className="text-zinc-600">{filePath(file.newPath)}</span>
                  <span>{fileName(file.newPath)}</span>
                </span>
                <span className="ml-auto shrink-0 text-[9px]">
                  {file.additions > 0 && <span className="text-green-500/70">+{file.additions}</span>}
                  {file.additions > 0 && file.deletions > 0 && <span className="text-zinc-600"> </span>}
                  {file.deletions > 0 && <span className="text-red-500/70">-{file.deletions}</span>}
                </span>
              </button>
            )
          })}
        </div>

        {/* Diff panel */}
        <div className="diff-viewer-tile-content">
          {selectedDiff && diffFileInstance ? (
            <DiffView
              diffFile={diffFileInstance}
              diffViewMode={viewMode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
              diffViewTheme="dark"
              diffViewWrap={true}
              diffViewFontSize={12}
              diffViewHighlight={true}
            />
          ) : selectedDiff && !selectedDiff.rawDiff ? (
            <div className="flex h-full items-center justify-center text-xs text-zinc-500">
              Binary file or no diff available
            </div>
          ) : !selectedFile ? (
            <div className="flex h-full items-center justify-center text-xs text-zinc-500">
              Select a file to view diff
            </div>
          ) : null}
        </div>
      </div>

      {/* Hidden diff-target handle for programmatic connection */}
      <Handle
        type="target"
        position={Position.Top}
        id="diff-target"
        isConnectableStart={false}
        isConnectableEnd={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0"
      />
    </div>
  )
}

export const DiffViewerTile = memo(DiffViewerTileComponent)

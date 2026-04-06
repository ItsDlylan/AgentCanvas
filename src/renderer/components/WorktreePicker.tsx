import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { WorktreeInfo } from '../../preload/index'

interface WorktreePickerProps {
  sessionId: string
  cwd?: string
  currentWorktree?: { branch?: string; path?: string }
}

function WorktreePickerComponent({ sessionId, cwd, currentWorktree }: WorktreePickerProps) {
  const [open, setOpen] = useState(false)
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchWorktrees = useCallback(async () => {
    if (!cwd) return
    setLoading(true)
    try {
      const wts = await window.terminal.listWorktrees(cwd)
      setWorktrees(wts)
    } catch {
      setWorktrees([])
    }
    setLoading(false)
  }, [cwd])

  const handleToggle = useCallback(() => {
    if (!open) fetchWorktrees()
    setOpen(prev => !prev)
  }, [open, fetchWorktrees])

  const assignWorktree = useCallback(async (wt: WorktreeInfo) => {
    await window.terminal.setMetadata(sessionId, 'worktree', {
      branch: wt.branch,
      path: wt.path
    })
    // cd into the worktree directory in the running terminal
    window.terminal.write(sessionId, `cd ${JSON.stringify(wt.path)}\n`)
    setOpen(false)
  }, [sessionId])

  const unassignWorktree = useCallback(async () => {
    await window.terminal.setMetadata(sessionId, 'worktree', null)
    setOpen(false)
  }, [sessionId])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const hasWorktree = !!currentWorktree?.branch

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className={`titlebar-no-drag rounded px-1.5 py-0.5 text-xs ${
          hasWorktree
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'
        }`}
        onClick={handleToggle}
        title={hasWorktree ? `Worktree: ${currentWorktree.branch}` : 'Assign worktree'}
      >
        WT
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[220px] rounded border border-zinc-700 bg-zinc-900 shadow-xl">
          {loading ? (
            <div className="px-3 py-2 text-xs text-zinc-500">Loading...</div>
          ) : worktrees.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-500">No worktrees found</div>
          ) : (
            <div className="max-h-[200px] overflow-y-auto">
              {worktrees.map(wt => {
                const isActive = currentWorktree?.path === wt.path
                return (
                  <button
                    key={wt.path}
                    className={`titlebar-no-drag block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${
                      isActive ? 'text-emerald-400' : 'text-zinc-300'
                    }`}
                    onClick={() => assignWorktree(wt)}
                    title={wt.path}
                  >
                    <span className="font-medium">{wt.branch || '(detached)'}</span>
                    <span className="ml-2 text-zinc-600 text-[10px]">{shortenPath(wt.path)}</span>
                  </button>
                )
              })}
            </div>
          )}
          {hasWorktree && (
            <button
              className="titlebar-no-drag block w-full border-t border-zinc-700 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-800"
              onClick={unassignWorktree}
            >
              Unassign worktree
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function shortenPath(path: string): string {
  const home = path.replace(/^\/Users\/[^/]+/, '~')
  const parts = home.split('/')
  if (parts.length <= 3) return home
  return parts[0] + '/.../' + parts.slice(-2).join('/')
}

export const WorktreePicker = memo(WorktreePickerComponent)

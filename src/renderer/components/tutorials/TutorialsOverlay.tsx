import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTutorialById } from '@/data/tutorials'
import type { Tutorial } from '@/data/tutorials'
import { useSettings } from '@/hooks/useSettings'
import { TutorialsLibrary } from './TutorialsLibrary'
import { TutorialDetail } from './TutorialDetail'
import './tutorialsOverlay.css'

interface TutorialsOverlayProps {
  initialTutorialId?: string | null
  onClose: () => void
}

type Mode = 'library' | 'detail'

export function TutorialsOverlay({ initialTutorialId, onClose }: TutorialsOverlayProps) {
  const { settings, updateSettings } = useSettings()

  const initialTutorial = useMemo(() => {
    if (!initialTutorialId) return null
    const t = getTutorialById(initialTutorialId)
    if (!t || t.status === 'comingSoon') return null
    return t
  }, [initialTutorialId])

  const [mode, setMode] = useState<Mode>(initialTutorial ? 'detail' : 'library')
  const [activeId, setActiveId] = useState<string | null>(
    initialTutorial ? initialTutorial.id : null
  )
  const [query, setQuery] = useState('')

  const searchRef = useRef<HTMLInputElement | null>(null)
  const libraryScrollRef = useRef<HTMLDivElement | null>(null)
  const savedScrollRef = useRef(0)

  const active = activeId ? getTutorialById(activeId) ?? null : null

  // Focus search on mount when in library view
  useEffect(() => {
    if (mode === 'library') searchRef.current?.focus()
  }, [mode])

  // Escape closes the overlay (detail view uses its own Back button)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (mode === 'detail') {
          goBack()
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, onClose])

  const markWatched = useCallback(
    (id: string) => {
      const current = settings.tutorials?.seenIds ?? []
      if (current.includes(id)) return
      updateSettings({
        tutorials: {
          seenIds: [...current, id],
          seenWelcomeAt: settings.tutorials?.seenWelcomeAt ?? new Date().toISOString()
        }
      })
    },
    [settings.tutorials, updateSettings]
  )

  const selectTutorial = useCallback((t: Tutorial) => {
    if (t.status === 'comingSoon') return
    savedScrollRef.current = libraryScrollRef.current?.scrollTop ?? 0
    setActiveId(t.id)
    setMode('detail')
  }, [])

  const goBack = useCallback(() => {
    setMode('library')
    // Restore scroll after the library re-renders
    requestAnimationFrame(() => {
      if (libraryScrollRef.current) {
        libraryScrollRef.current.scrollTop = savedScrollRef.current
      }
    })
  }, [])

  const onBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tutorials"
      onMouseDown={onBackdropMouseDown}
      className="tutorials-overlay-enter fixed inset-0 z-[9999] flex flex-col bg-zinc-950/95 backdrop-blur-md"
    >
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center gap-4 border-b border-zinc-800/80 bg-zinc-900/70 px-6">
        <div className="flex min-w-[180px] flex-col">
          <span className="text-sm font-semibold text-zinc-100">Tutorials</span>
          <span className="text-[11px] text-zinc-500">Learn AgentCanvas in small pieces</span>
        </div>

        <div className="relative flex-1 max-w-xl">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tutorials…"
            className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-900 pl-9 pr-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30"
            disabled={mode === 'detail'}
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close tutorials"
            title="Close (Esc)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {mode === 'library' || !active ? (
        <TutorialsLibrary
          query={query}
          settings={settings}
          onSelect={selectTutorial}
          scrollRef={libraryScrollRef}
        />
      ) : (
        <TutorialDetail
          tutorial={active}
          settings={settings}
          onSelect={selectTutorial}
          onBack={goBack}
          onWatched={markWatched}
        />
      )}
    </div>
  )
}

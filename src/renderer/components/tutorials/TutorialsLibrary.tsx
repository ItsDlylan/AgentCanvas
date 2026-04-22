import { useMemo, useRef, type ReactNode } from 'react'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  filterTutorials,
  groupTutorialsByCategory,
  isNew as tutorialIsNew,
  isWatched
} from '@/data/tutorials'
import type { Tutorial } from '@/data/tutorials'
import type { Settings } from '@/types/settings'
import { TutorialCard } from './TutorialCard'

interface TutorialsLibraryProps {
  query: string
  activeTags: readonly string[]
  settings: Settings
  onSelect: (tutorial: Tutorial) => void
  scrollRef?: React.RefObject<HTMLDivElement | null>
}

export function TutorialsLibrary({ query, activeTags, settings, onSelect, scrollRef }: TutorialsLibraryProps) {
  const fallbackRef = useRef<HTMLDivElement | null>(null)
  const ref = scrollRef ?? fallbackRef

  const grouped = useMemo(() => {
    const filtered = filterTutorials(query, activeTags)
    return groupTutorialsByCategory(filtered)
  }, [query, activeTags])

  const totalCount = useMemo(
    () => Array.from(grouped.values()).reduce((sum, list) => sum + list.length, 0),
    [grouped]
  )

  let sections: ReactNode

  if (totalCount === 0) {
    const hasQuery = query.trim().length > 0
    const hasTags = activeTags.length > 0
    const reason = hasQuery && hasTags
      ? `"${query.trim()}" with tag${activeTags.length > 1 ? 's' : ''} ${activeTags.join(', ')}`
      : hasQuery
      ? `"${query.trim()}"`
      : `tag${activeTags.length > 1 ? 's' : ''} ${activeTags.join(', ')}`
    sections = (
      <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
        <div className="text-sm text-zinc-400">No tutorials match {reason}</div>
        <div className="text-xs text-zinc-600">Try a different keyword, or clear your filters.</div>
      </div>
    )
  } else {
    let cardIndex = 0
    sections = CATEGORY_ORDER.map((cat) => {
      const list = grouped.get(cat) ?? []
      if (list.length === 0) return null
      return (
        <section key={cat} className="mb-10">
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              {CATEGORY_LABELS[cat]}
            </h2>
            <span className="text-[11px] text-zinc-700">{list.length}</span>
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
            {list.map((t) => {
              const index = cardIndex++
              return (
                <TutorialCard
                  key={t.id}
                  tutorial={t}
                  watched={isWatched(t.id, settings)}
                  isNew={tutorialIsNew(t, settings)}
                  index={index}
                  onClick={() => onSelect(t)}
                />
              )
            })}
          </div>
        </section>
      )
    })
  }

  return (
    <div ref={ref} className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-6">{sections}</div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CATEGORY_LABELS,
  TUTORIALS,
  formatDuration,
  isWatched
} from '@/data/tutorials'
import type { Tutorial } from '@/data/tutorials'
import type { Settings } from '@/types/settings'

interface TutorialDetailProps {
  tutorial: Tutorial
  settings: Settings
  onSelect: (tutorial: Tutorial) => void
  onBack: () => void
  onWatched: (id: string) => void
}

export function TutorialDetail({ tutorial, settings, onSelect, onBack, onWatched }: TutorialDetailProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [imageStep, setImageStep] = useState(0)

  // Reset local state when the active tutorial changes
  useEffect(() => {
    setImageStep(0)
  }, [tutorial.id])

  // Keyboard shortcuts for the video player
  useEffect(() => {
    if (tutorial.media.type !== 'video') return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const video = videoRef.current
      if (!video) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        video.currentTime = Math.max(0, video.currentTime - 5)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5)
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        if (document.fullscreenElement) void document.exitFullscreen()
        else void video.requestFullscreen?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tutorial.id, tutorial.media.type])

  const related = useMemo(
    () =>
      TUTORIALS.filter(
        (t) => t.category === tutorial.category && t.id !== tutorial.id
      ),
    [tutorial.category, tutorial.id]
  )

  const media = tutorial.media

  let player: React.ReactNode
  if (media.type === 'video') {
    player = (
      <video
        ref={videoRef}
        src={media.src}
        poster={media.posterSrc}
        controls
        autoPlay
        preload="metadata"
        onEnded={() => onWatched(tutorial.id)}
        className="h-full w-full rounded-lg bg-black object-contain"
      />
    )
  } else if (media.type === 'image') {
    player = (
      <img
        src={media.src}
        alt={media.alt ?? tutorial.title}
        className="h-full w-full rounded-lg bg-black object-contain"
      />
    )
  } else {
    const total = media.srcs.length
    const current = media.srcs[Math.min(imageStep, total - 1)]
    player = (
      <div className="relative flex h-full w-full items-center justify-center rounded-lg bg-black">
        <img
          src={current}
          alt={media.alt ?? tutorial.title}
          className="max-h-full max-w-full object-contain"
        />
        {total > 1 && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-zinc-200 ring-1 ring-white/10">
            <button
              type="button"
              onClick={() => setImageStep((i) => Math.max(0, i - 1))}
              disabled={imageStep === 0}
              className="text-zinc-400 hover:text-white disabled:opacity-40"
              aria-label="Previous step"
            >
              ←
            </button>
            <span className="tabular-nums">
              {Math.min(imageStep, total - 1) + 1} / {total}
            </span>
            <button
              type="button"
              onClick={() => setImageStep((i) => Math.min(total - 1, i + 1))}
              disabled={imageStep >= total - 1}
              className="text-zinc-400 hover:text-white disabled:opacity-40"
              aria-label="Next step"
            >
              →
            </button>
          </div>
        )}
      </div>
    )
  }

  const durationLabel =
    media.type === 'video' ? formatDuration(media.durationSec) : null

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: player + description */}
      <div className="flex flex-1 flex-col overflow-y-auto px-8 py-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col">
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to library
          </button>

          <div className="aspect-video w-full overflow-hidden rounded-lg ring-1 ring-zinc-800">
            {player}
          </div>

          <div className="mt-5">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500">
              <span className="rounded-full bg-zinc-800/80 px-2 py-0.5 text-zinc-300">
                {CATEGORY_LABELS[tutorial.category]}
              </span>
              {durationLabel && <span>{durationLabel}</span>}
              {tutorial.tags && tutorial.tags.length > 0 && (
                <span className="text-zinc-600">· {tutorial.tags.join(' · ')}</span>
              )}
            </div>
            <h1 className="mt-2 text-xl font-semibold text-zinc-100">{tutorial.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              {tutorial.description}
            </p>
            {media.type === 'video' && (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-600">
                <span>Space — play/pause</span>
                <span>←/→ — seek 5s</span>
                <span>F — fullscreen</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right rail: more in category */}
      <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-zinc-800/80 bg-zinc-950/40 px-4 py-6">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          More in {CATEGORY_LABELS[tutorial.category]}
        </div>
        {related.length === 0 ? (
          <div className="text-xs text-zinc-600">Nothing else here yet.</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {related.map((t) => {
              const comingSoon = t.status === 'comingSoon'
              const watched = isWatched(t.id, settings)
              const dur =
                t.media.type === 'video' ? formatDuration(t.media.durationSec) : null
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={comingSoon ? undefined : () => onSelect(t)}
                    disabled={comingSoon}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors ${
                      comingSoon
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className="tutorial-thumb-gradient relative h-12 w-20 shrink-0 overflow-hidden rounded-md ring-1 ring-zinc-800">
                      {t.media.type === 'video' && t.media.posterSrc && (
                        <img src={t.media.posterSrc} alt="" className="h-full w-full object-cover opacity-80" />
                      )}
                      <span className="absolute inset-0 flex items-center justify-center text-zinc-200/80">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-zinc-200">{t.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                        {dur && <span className="tabular-nums">{dur}</span>}
                        {comingSoon && <span>Coming soon</span>}
                        {watched && !comingSoon && <span className="text-zinc-400">Watched</span>}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>
    </div>
  )
}

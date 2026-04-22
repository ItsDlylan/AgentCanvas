import type { Tutorial } from '@/data/tutorials'
import { formatDuration } from '@/data/tutorials'

interface TutorialCardProps {
  tutorial: Tutorial
  watched: boolean
  isNew: boolean
  index: number
  onClick: () => void
}

export function TutorialCard({ tutorial, watched, isNew, index, onClick }: TutorialCardProps) {
  const comingSoon = tutorial.status === 'comingSoon'
  const isVideo = tutorial.media.type === 'video'
  const poster =
    tutorial.media.type === 'video' ? tutorial.media.posterSrc : undefined
  const durationLabel = isVideo
    ? formatDuration((tutorial.media as { durationSec: number }).durationSec)
    : null

  const stagger = Math.min(index, 10) * 24

  return (
    <button
      type="button"
      onClick={comingSoon ? undefined : onClick}
      disabled={comingSoon}
      className={`group tutorial-card-enter flex flex-col text-left ${
        comingSoon ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
      style={{ animationDelay: `${stagger}ms` }}
      aria-label={tutorial.title}
    >
      <div
        className={`tutorial-thumb-gradient relative aspect-video overflow-hidden rounded-lg border transition-all ${
          comingSoon
            ? 'border-zinc-800'
            : 'border-zinc-800 group-hover:-translate-y-0.5 group-hover:border-blue-500/60 group-hover:shadow-lg group-hover:shadow-blue-500/10'
        }`}
      >
        {poster && (
          <img
            src={poster}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-80"
          />
        )}
        {/* Play button / type icon overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm ring-1 ring-white/10 transition-transform ${
              comingSoon ? '' : 'group-hover:scale-110'
            }`}
          >
            {isVideo ? (
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="ml-0.5 h-5 w-5 text-white"
                aria-hidden
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="h-5 w-5 text-white"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"
                />
              </svg>
            )}
          </div>
        </div>
        {/* Top-right status pill */}
        {comingSoon ? (
          <span className="absolute right-2 top-2 rounded-full bg-zinc-800/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            Coming soon
          </span>
        ) : watched ? (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-zinc-800/90 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Watched
          </span>
        ) : isNew ? (
          <span className="absolute right-2 top-2 rounded-full bg-blue-500/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm">
            New
          </span>
        ) : null}
        {/* Bottom-right duration */}
        {durationLabel && !comingSoon && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-200">
            {durationLabel}
          </span>
        )}
      </div>
      <div className="mt-2 min-w-0">
        <div className="truncate text-sm font-medium text-zinc-200">{tutorial.title}</div>
        <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{tutorial.description}</div>
      </div>
    </button>
  )
}

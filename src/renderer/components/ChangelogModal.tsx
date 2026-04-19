import { useEffect, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

interface ChangelogModalProps {
  open: boolean
  version: string
  markdown: string
  releaseUrl: string
  onClose: () => void
}

export function ChangelogModal({ open, version, markdown, releaseUrl, onClose }: ChangelogModalProps) {
  const html = useMemo(() => {
    if (!markdown) return '<p class="text-zinc-400">No changelog provided.</p>'
    const rendered = marked.parse(markdown, { async: false }) as string
    return DOMPurify.sanitize(rendered)
  }, [markdown])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70"
      onMouseDown={onClose}
    >
      <div
        className="w-[90%] max-w-2xl max-h-[80vh] flex flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-medium text-zinc-200">What's new in v{version}</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          className="changelog-body overflow-y-auto px-5 py-4 text-sm text-zinc-300"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
          <a
            href={releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-zinc-400 hover:text-zinc-200 hover:underline"
          >
            View on GitHub →
          </a>
          <button
            onClick={onClose}
            className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { ChangelogModal } from './ChangelogModal'
import type { UpdateStatus, UpdateAvailableInfo, UpdateProgress } from '../../preload/index'

const SNOOZE_KEY = 'agentcanvas:update:snoozed-version'

function readSnoozed(): string | null {
  try { return localStorage.getItem(SNOOZE_KEY) } catch { return null }
}

function writeSnoozed(version: string): void {
  try { localStorage.setItem(SNOOZE_KEY, version) } catch { /* ignore */ }
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

export function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [showChangelog, setShowChangelog] = useState(false)
  const [snoozedVersion, setSnoozedVersion] = useState<string | null>(readSnoozed())

  useEffect(() => {
    let cancelled = false
    window.updater.getStatus().then((s) => {
      if (!cancelled) setStatus(s)
    })
    const off = window.updater.onStatusChange((s) => setStatus(s))
    return () => {
      cancelled = true
      off()
    }
  }, [])

  if (!status) return null
  if (status.phase === 'idle' || status.phase === 'checking') return null

  const available: UpdateAvailableInfo | null = status.available
  if (!available) return null

  // Hide if user snoozed this exact version
  if (status.phase === 'available' && snoozedVersion === available.version) return null

  const progress: UpdateProgress | null = status.progress

  const handleDownload = (): void => { window.updater.download() }
  const handleCancel = (): void => { window.updater.cancel() }
  const handleInstall = (): void => { window.updater.install() }
  const handleSnooze = (): void => {
    writeSnoozed(available.version)
    setSnoozedVersion(available.version)
  }
  const handleRetry = (): void => { window.updater.download() }

  return (
    <>
      <div
        className="pointer-events-auto fixed bottom-4 left-4 z-[9999] w-[340px] rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 shadow-2xl backdrop-blur"
      >
        {status.phase === 'available' && (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs font-medium text-zinc-200">Update available</div>
                <div className="mt-0.5 text-[11px] text-zinc-400">
                  v{available.currentVersion} → <span className="text-zinc-200">v{available.version}</span>
                  <span className="mx-1.5 text-zinc-600">·</span>
                  {formatBytes(available.sizeBytes)}
                </div>
              </div>
              <button
                onClick={handleSnooze}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                aria-label="Dismiss until next version"
                title="Remind me again next version"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handleDownload}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
              >
                Download
              </button>
              <button
                onClick={() => setShowChangelog(true)}
                className="rounded px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                View changelog
              </button>
            </div>
          </>
        )}

        {status.phase === 'downloading' && (
          <>
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-zinc-200">Downloading v{available.version}</div>
              <button
                onClick={handleCancel}
                className="text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-150"
                style={{ width: `${Math.round((progress?.percent ?? 0) * 100)}%` }}
              />
            </div>
            <div className="mt-1.5 text-[11px] text-zinc-500">
              {formatBytes(progress?.transferredBytes ?? 0)} / {formatBytes(progress?.totalBytes ?? available.sizeBytes)}
              <span className="ml-1.5 text-zinc-400">{Math.round((progress?.percent ?? 0) * 100)}%</span>
            </div>
          </>
        )}

        {status.phase === 'downloaded' && (
          <>
            <div className="text-xs font-medium text-zinc-200">v{available.version} ready to install</div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
              Finder will open the installer. Drag <span className="text-zinc-300">AgentCanvas</span> into <span className="text-zinc-300">/Applications</span>, then relaunch.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handleInstall}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
              >
                Reveal &amp; Install
              </button>
              <button
                onClick={() => setShowChangelog(true)}
                className="rounded px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                View changelog
              </button>
            </div>
          </>
        )}

        {status.phase === 'error' && (
          <>
            <div className="text-xs font-medium text-red-400">Update failed</div>
            <p className="mt-1 text-[11px] text-zinc-400">{status.error ?? 'Unknown error'}</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handleRetry}
                className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600"
              >
                Retry
              </button>
              <a
                href={available.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                Open release page
              </a>
            </div>
          </>
        )}
      </div>

      <ChangelogModal
        open={showChangelog}
        version={available.version}
        markdown={available.changelog}
        releaseUrl={available.releaseUrl}
        onClose={() => setShowChangelog(false)}
      />
    </>
  )
}

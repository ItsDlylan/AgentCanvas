import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { createWriteStream, createReadStream, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import semver from 'semver'
import YAML from 'yaml'

import type { Settings } from './settings-store'

// ── Constants ────────────────────────────────────────────

const REPO_OWNER = 'ItsDlylan'
const REPO_NAME = 'AgentCanvas'
const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
const PROGRESS_THROTTLE_MS = 100
const USER_AGENT = `AgentCanvas/${app.getVersion()}`
const LAUNCH_CHECK_DELAY_MS = 10_000

// ── Types ────────────────────────────────────────────────

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

interface AvailableInfo {
  version: string
  currentVersion: string
  downloadUrl: string
  changelog: string
  sizeBytes: number
  sha512: string
  releaseUrl: string
}

interface DownloadProgress {
  percent: number
  transferredBytes: number
  totalBytes: number
}

interface UpdateStatus {
  phase: Phase
  available: AvailableInfo | null
  progress: DownloadProgress | null
  filePath: string | null
  error: string | null
}

interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GitHubRelease {
  tag_name: string
  name: string
  body: string
  html_url: string
  assets: GitHubAsset[]
  draft: boolean
  prerelease: boolean
}

// ── State ────────────────────────────────────────────────

let mainWindowRef: BrowserWindow | null = null
let getSettingsRef: (() => Settings) | null = null
let periodicTimer: NodeJS.Timeout | null = null
let abortDownload: AbortController | null = null

const status: UpdateStatus = {
  phase: 'idle',
  available: null,
  progress: null,
  filePath: null,
  error: null
}

// ── Helpers ──────────────────────────────────────────────

function emit(event: string, payload?: unknown): void {
  mainWindowRef?.webContents.send(event, payload)
}

function setPhase(phase: Phase, partial?: Partial<UpdateStatus>): void {
  status.phase = phase
  if (partial) Object.assign(status, partial)
  emit('updater:status', status)
}

function pickAssetForArch(release: GitHubRelease): GitHubAsset | null {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const wantedSuffix = `mac-${arch}.dmg`
  return release.assets.find((a) => a.name.toLowerCase().endsWith(wantedSuffix)) ?? null
}

function findYmlAsset(release: GitHubRelease): GitHubAsset | null {
  return release.assets.find((a) => a.name === 'latest-mac.yml') ?? null
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    signal
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`)
  return (await res.json()) as T
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal })
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`)
  return await res.text()
}

interface LatestMacYml {
  files: Array<{ url: string; sha512: string; size: number }>
}

function findHashForFile(yml: LatestMacYml, fileName: string): string | null {
  const entry = yml.files.find((f) => f.url.endsWith(fileName) || f.url === fileName)
  return entry?.sha512 ?? null
}

async function sha512OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha512')
  await pipeline(createReadStream(filePath), hash)
  // electron-builder stores SHA512 as base64
  return hash.digest('base64')
}

// ── Public surface ───────────────────────────────────────

export function initUpdater(window: BrowserWindow, getSettings: () => Settings): void {
  mainWindowRef = window
  getSettingsRef = getSettings

  registerIpc()
  scheduleChecks()
}

export function getStatus(): UpdateStatus {
  return status
}

function registerIpc(): void {
  ipcMain.handle('updater:check', () => checkForUpdate({ silent: false }))
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:install', () => revealAndInstall())
  ipcMain.handle('updater:cancel', () => cancelDownload())
  ipcMain.handle('updater:get-version', () => app.getVersion())
  ipcMain.handle('updater:get-status', () => status)
}

function scheduleChecks(): void {
  const settings = getSettingsRef?.()
  if (!settings) return

  if (settings.updates.autoCheckOnLaunch) {
    setTimeout(() => {
      checkForUpdate({ silent: true }).catch(() => { /* swallow background errors */ })
    }, LAUNCH_CHECK_DELAY_MS)
  }

  if (periodicTimer) {
    clearInterval(periodicTimer)
    periodicTimer = null
  }

  if (settings.updates.autoCheckPeriodic) {
    const intervalMs = Math.max(1, settings.updates.checkIntervalHours) * 60 * 60 * 1000
    periodicTimer = setInterval(() => {
      checkForUpdate({ silent: true }).catch(() => { /* swallow */ })
    }, intervalMs)
  }
}

export function reschedule(): void {
  scheduleChecks()
}

// ── Check ────────────────────────────────────────────────

async function checkForUpdate({ silent }: { silent: boolean }): Promise<UpdateStatus> {
  if (status.phase === 'downloading' || status.phase === 'checking') return status

  setPhase('checking', { error: null })

  try {
    const release = await fetchJson<GitHubRelease>(RELEASES_API)
    if (release.draft || release.prerelease) {
      setPhase('idle')
      return status
    }

    const remoteVersion = release.tag_name.replace(/^v/, '')
    const currentVersion = app.getVersion()

    if (!semver.valid(remoteVersion) || !semver.gt(remoteVersion, currentVersion)) {
      setPhase('idle')
      if (!silent) emit('updater:up-to-date', { version: currentVersion })
      return status
    }

    const dmg = pickAssetForArch(release)
    const yml = findYmlAsset(release)
    if (!dmg) {
      throw new Error(`No DMG asset for ${process.arch} in release ${release.tag_name}`)
    }

    let sha512 = ''
    if (yml) {
      try {
        const ymlText = await fetchText(yml.browser_download_url)
        const parsed = YAML.parse(ymlText) as LatestMacYml
        sha512 = findHashForFile(parsed, dmg.name) ?? ''
      } catch {
        // Verification metadata missing — proceed without hash check
      }
    }

    const available: AvailableInfo = {
      version: remoteVersion,
      currentVersion,
      downloadUrl: dmg.browser_download_url,
      changelog: release.body || '',
      sizeBytes: dmg.size,
      sha512,
      releaseUrl: release.html_url
    }

    setPhase('available', { available })
    emit('updater:available', available)
    return status
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setPhase('error', { error: message })
    if (!silent) emit('updater:error', { message })
    return status
  }
}

// ── Download ─────────────────────────────────────────────

async function downloadUpdate(): Promise<UpdateStatus> {
  if (!status.available) {
    setPhase('error', { error: 'No update available to download' })
    return status
  }
  if (status.phase === 'downloading' || status.phase === 'downloaded') return status

  const { downloadUrl, sizeBytes, sha512, version } = status.available
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const fileName = `AgentCanvas-${version}-mac-${arch}.dmg`
  const filePath = join(app.getPath('downloads'), fileName)

  abortDownload = new AbortController()
  setPhase('downloading', {
    progress: { percent: 0, transferredBytes: 0, totalBytes: sizeBytes },
    error: null,
    filePath: null
  })

  try {
    const res = await fetch(downloadUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: abortDownload.signal
    })
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`)

    const total = Number(res.headers.get('content-length')) || sizeBytes
    let transferred = 0
    let lastEmit = 0

    const fileStream = createWriteStream(filePath)
    const nodeStream = Readable.fromWeb(res.body as never)

    nodeStream.on('data', (chunk: Buffer) => {
      transferred += chunk.length
      const now = Date.now()
      if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
        lastEmit = now
        const progress: DownloadProgress = {
          percent: total > 0 ? transferred / total : 0,
          transferredBytes: transferred,
          totalBytes: total
        }
        status.progress = progress
        emit('updater:progress', progress)
      }
    })

    await pipeline(nodeStream, fileStream)

    if (sha512) {
      const actual = await sha512OfFile(filePath)
      if (actual !== sha512) {
        try { unlinkSync(filePath) } catch { /* ignore */ }
        throw new Error('Downloaded file failed integrity check')
      }
    }

    setPhase('downloaded', {
      filePath,
      progress: { percent: 1, transferredBytes: transferred, totalBytes: total }
    })
    emit('updater:downloaded', { filePath })
    return status
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      setPhase('available', { progress: null, error: null })
      return status
    }
    const message = err instanceof Error ? err.message : String(err)
    if (existsSync(filePath)) {
      try { unlinkSync(filePath) } catch { /* ignore */ }
    }
    setPhase('error', { error: message, progress: null })
    emit('updater:error', { message })
    return status
  } finally {
    abortDownload = null
  }
}

function cancelDownload(): void {
  abortDownload?.abort()
}

// ── Install (reveal in Finder) ───────────────────────────

async function revealAndInstall(): Promise<UpdateStatus> {
  if (!status.filePath) {
    setPhase('error', { error: 'No downloaded update to install' })
    return status
  }
  // shell.openPath returns '' on success, an error string otherwise
  const result = await shell.openPath(status.filePath)
  if (result) {
    setPhase('error', { error: `Failed to open DMG: ${result}` })
    emit('updater:error', { message: result })
  }
  return status
}

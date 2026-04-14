import { session, app } from 'electron'
import { join } from 'path'
import { readdirSync, existsSync, mkdirSync } from 'fs'

export const BROWSER_PARTITION = 'persist:agentcanvas'

export function getExtensionsDir(): string {
  return join(app.getPath('userData'), 'extensions')
}

export async function loadExtensions(): Promise<void> {
  const dir = getExtensionsDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    return
  }

  const ses = session.fromPartition(BROWSER_PARTITION)
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const extPath = join(dir, entry.name)
    if (!existsSync(join(extPath, 'manifest.json'))) continue

    try {
      const ext = await ses.loadExtension(extPath, { allowFileAccess: true })
      console.log(`[Extensions] Loaded: ${ext.name} (${ext.version})`)
    } catch (err) {
      console.warn(`[Extensions] Failed to load ${entry.name}:`, err)
    }
  }
}

export function getLoadedExtensions(): Electron.Extension[] {
  return session.fromPartition(BROWSER_PARTITION).getAllExtensions()
}

import { homedir } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync, existsSync, copyFileSync } from 'fs'
import { v4 as uuid } from 'uuid'

const IMAGE_DIR = join(homedir(), 'AgentCanvas', 'images')

export interface ImageMeta {
  imageId: string
  label: string
  workspaceId: string
  isSoftDeleted: boolean
  position: { x: number; y: number }
  width: number
  height: number
  sourcePath: string
  storedFilename: string
  createdAt: number
  updatedAt: number
}

export interface ImageFile {
  meta: ImageMeta
}

export function ensureImageDir(): void {
  if (!existsSync(IMAGE_DIR)) mkdirSync(IMAGE_DIR, { recursive: true })
}

/** Copy a source image into the images directory and return the stored filename. */
export function storeImage(sourcePath: string): string {
  ensureImageDir()
  const ext = sourcePath.match(/\.[^.]+$/)?.[0] ?? ''
  const storedFilename = `${uuid()}${ext}`
  copyFileSync(sourcePath, join(IMAGE_DIR, storedFilename))
  return storedFilename
}

/** Get the absolute path to a stored image file. */
export function getImagePath(storedFilename: string): string {
  return join(IMAGE_DIR, storedFilename)
}

export function loadImage(imageId: string): ImageFile | null {
  const filePath = join(IMAGE_DIR, `image-${imageId}.json`)
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as ImageFile
  } catch {
    return null
  }
}

export function saveImage(imageId: string, meta: Partial<ImageMeta>): void {
  ensureImageDir()
  const filePath = join(IMAGE_DIR, `image-${imageId}.json`)
  let existing: ImageFile | null = null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    existing = JSON.parse(raw) as ImageFile
  } catch {
    // new file
  }

  const now = Date.now()
  const file: ImageFile = {
    meta: {
      imageId,
      label: meta.label ?? existing?.meta?.label ?? 'Image',
      workspaceId: meta.workspaceId ?? existing?.meta?.workspaceId ?? 'default',
      isSoftDeleted: meta.isSoftDeleted ?? existing?.meta?.isSoftDeleted ?? false,
      position: meta.position ?? existing?.meta?.position ?? { x: 100, y: 100 },
      width: meta.width ?? existing?.meta?.width ?? 500,
      height: meta.height ?? existing?.meta?.height ?? 400,
      sourcePath: meta.sourcePath ?? existing?.meta?.sourcePath ?? '',
      storedFilename: meta.storedFilename ?? existing?.meta?.storedFilename ?? '',
      createdAt: existing?.meta?.createdAt ?? now,
      updatedAt: now
    }
  }

  writeFileSync(filePath, JSON.stringify(file, null, 2))
}

export function deleteImage(imageId: string): void {
  const filePath = join(IMAGE_DIR, `image-${imageId}.json`)
  try {
    // Also delete the stored image file
    const existing = loadImage(imageId)
    if (existing?.meta.storedFilename) {
      const imgPath = join(IMAGE_DIR, existing.meta.storedFilename)
      try { unlinkSync(imgPath) } catch { /* already gone */ }
    }
    unlinkSync(filePath)
  } catch {
    // File already gone
  }
}

export function listImages(): ImageFile[] {
  ensureImageDir()
  try {
    const files = readdirSync(IMAGE_DIR).filter((f) => f.startsWith('image-') && f.endsWith('.json'))
    const results: ImageFile[] = []
    for (const f of files) {
      try {
        const imageId = f.replace(/^image-/, '').replace(/\.json$/, '')
        const loaded = loadImage(imageId)
        if (loaded) results.push(loaded)
      } catch {
        // skip corrupt files
      }
    }
    return results
  } catch {
    return []
  }
}

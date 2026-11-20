import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { MediaMeta } from '@olps/domain'
import { SITE_PATHS } from './paths.js'
import { assertNotSymlinkOrJunction, assertSafePathChain } from './path-guard.js'

export const IMAGE_WIDTHS = [480, 960, 1440, 1920] as const

const RASTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export type ImageOutputFile = {
  relativePath: string
  content: Buffer
}

export type ProcessImagesResult = {
  outputs: ImageOutputFile[]
}

export type ProcessImagesOptions = {
  sharpImpl?: typeof sharp
}

function extensionOf(filePath: string): string {
  return path.posix.extname(filePath.replace(/\\/g, '/')).toLowerCase()
}

function stemAndDir(mediaPath: string): { dir: string; stem: string; ext: string } {
  const normalized = mediaPath.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const dir = slash >= 0 ? normalized.slice(0, slash + 1) : ''
  const file = slash >= 0 ? normalized.slice(slash + 1) : normalized
  const dot = file.lastIndexOf('.')
  const stem = dot >= 0 ? file.slice(0, dot) : file
  const ext = dot >= 0 ? file.slice(dot) : ''
  return { dir, stem, ext }
}

function isRasterImage(media: MediaMeta): boolean {
  if (!media.mimeType.startsWith('image/')) {
    return false
  }
  if (media.mimeType === 'image/svg+xml' || media.mimeType === 'image/gif') {
    return false
  }
  return RASTER_EXTENSIONS.has(extensionOf(media.path))
}

async function ensureCacheDir(workspacePath: string, hash: string): Promise<string> {
  const relative = path.posix.join(SITE_PATHS.cacheDir, 'images', hash)
  const abs = await assertSafePathChain(workspacePath, relative, { allowMissingSuffix: true })
  await fs.mkdir(abs, { recursive: true })
  return abs
}

async function readCacheFile(cacheDir: string, fileName: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(cacheDir, fileName))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function processImages(
  workspacePath: string,
  mediaList: MediaMeta[],
  options: ProcessImagesOptions = {},
): Promise<ProcessImagesResult> {
  const sharpImpl = options.sharpImpl ?? sharp
  const outputs: ImageOutputFile[] = []

  for (const media of mediaList) {
    if (!isRasterImage(media)) {
      continue
    }
    if (media.width === null || media.height === null) {
      throw new Error(`栅格图片缺少宽高：${media.mediaId}`)
    }

    const sourceAbs = await assertSafePathChain(workspacePath, media.path)
    await assertNotSymlinkOrJunction(sourceAbs)
    const sourceBytes = await fs.readFile(sourceAbs)
    const hash = createHash('sha256').update(sourceBytes).digest('hex')
    const cacheDir = await ensureCacheDir(workspacePath, hash)
    const { dir, stem, ext } = stemAndDir(media.path)

    const planned: Array<{ fileName: string; relativePath: string; build: () => Promise<Buffer> }> = []

    planned.push({
      fileName: `${stem}.webp`,
      relativePath: `${dir}${stem}.webp`,
      build: async () => sharpImpl(sourceBytes).webp().toBuffer(),
    })

    for (const width of IMAGE_WIDTHS) {
      if (width > media.width) {
        continue
      }
      planned.push({
        fileName: `${stem}-${width}w${ext}`,
        relativePath: `${dir}${stem}-${width}w${ext}`,
        build: async () =>
          sharpImpl(sourceBytes)
            .resize({ width, withoutEnlargement: true })
            .toBuffer(),
      })
      planned.push({
        fileName: `${stem}-${width}w.webp`,
        relativePath: `${dir}${stem}-${width}w.webp`,
        build: async () =>
          sharpImpl(sourceBytes)
            .resize({ width, withoutEnlargement: true })
            .webp()
            .toBuffer(),
      })
    }

    for (const item of planned) {
      let content = await readCacheFile(cacheDir, item.fileName)
      if (!content) {
        content = await item.build()
        await fs.writeFile(path.join(cacheDir, item.fileName), content)
      }
      outputs.push({
        relativePath: path.posix.join(SITE_PATHS.publicDir, item.relativePath),
        content,
      })
    }
  }

  return { outputs }
}

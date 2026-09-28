import fs from 'node:fs/promises'
import path from 'node:path'
import { appConfig } from './config.js'
import { PREVIEW_PUBLISH_SITE_SEGMENT } from './preview-build.js'

const BLOCKED_SEGMENTS = new Set(['source', '.git', 'tools', 'node_modules'])

async function assertNotSymlinkOrJunction(filePath: string): Promise<void> {
  const stat = await fs.lstat(filePath)
  if (stat.isSymbolicLink()) {
    throw new Error('PREVIEW_FORBIDDEN')
  }
}

function decodeSubPath(encoded: string): string {
  const decoded = decodeURIComponent(encoded)
  if (decoded.includes('\\') || decoded.includes('\0')) {
    throw new Error('PREVIEW_FORBIDDEN')
  }
  return decoded.replace(/^\/+/, '')
}

export function normalizePreviewSubPath(rawSubPath: string): string {
  const subPath = decodeSubPath(rawSubPath)
  const segments = subPath.split('/').filter((part) => part.length > 0)
  if (segments.some((part) => part === '..' || part === '.')) {
    throw new Error('PREVIEW_FORBIDDEN')
  }
  if (segments.some((part) => BLOCKED_SEGMENTS.has(part.toLowerCase()))) {
    throw new Error('PREVIEW_FORBIDDEN')
  }

  if (segments.length === 0) {
    throw new Error('PREVIEW_NOT_FOUND')
  }

  if (segments[0] === 's' && segments[1] === PREVIEW_PUBLISH_SITE_SEGMENT) {
    const rest = segments.slice(2)
    if (rest.length === 0) {
      throw new Error('PREVIEW_NOT_FOUND')
    }
    return rest.join('/')
  }

  return segments.join('/')
}

export async function readPreviewCapabilityFile(
  capabilityId: string,
  rawSubPath: string,
): Promise<{ content: Buffer; contentType: string }> {
  const relative = normalizePreviewSubPath(rawSubPath)
  if (relative.split('/').some((part) => part === '..')) {
    throw new Error('PREVIEW_FORBIDDEN')
  }

  let fileRelative = relative
  if (!fileRelative.includes('.') || fileRelative.endsWith('/')) {
    fileRelative = `${fileRelative.replace(/\/+$/, '')}/index.html`
  }

  const root = path.resolve(appConfig.previewRoot, 'capabilities', capabilityId)
  const abs = path.resolve(root, fileRelative)
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error('PREVIEW_FORBIDDEN')
  }

  await assertNotSymlinkOrJunction(root)
  let cursor = root
  for (const part of fileRelative.split('/').filter(Boolean)) {
    cursor = path.join(cursor, part)
    try {
      await assertNotSymlinkOrJunction(cursor)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new Error('PREVIEW_NOT_FOUND')
      }
      throw err
    }
  }

  let content: Buffer
  try {
    content = await fs.readFile(abs)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error('PREVIEW_NOT_FOUND')
    }
    throw err
  }
  const lower = fileRelative.toLowerCase()
  if (lower.endsWith('.css')) {
    return { content, contentType: 'text/css; charset=utf-8' }
  }
  if (lower.endsWith('.html')) {
    return { content, contentType: 'text/html; charset=utf-8' }
  }
  if (lower.endsWith('.js')) {
    return { content, contentType: 'text/javascript; charset=utf-8' }
  }
  if (lower.endsWith('.xml')) {
    return { content, contentType: 'application/xml; charset=utf-8' }
  }
  return { content, contentType: 'application/octet-stream' }
}

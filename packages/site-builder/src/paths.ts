import fs from 'node:fs/promises'
import path from 'node:path'

export const SOURCE_DIR = 'source'
export const PUBLIC_DIR = 'public'
export const PAGES_SUBDIR = path.join(SOURCE_DIR, 'pages')
export const ASSETS_SUBDIR = 'assets'
export const SITE_SETTINGS_FILE = path.join(SOURCE_DIR, 'site-settings.json')
export const PUBLISH_CONFIG_FILE = path.join(SOURCE_DIR, 'publish-config.json')
export const MANIFEST_FILE = 'olps.manifest.json'

export function assertSafeSlug(slug: string): void {
  if (!slug || typeof slug !== 'string') {
    throw new Error('slug 无效')
  }
  if (path.isAbsolute(slug)) {
    throw new Error(`slug 不允许绝对路径: ${slug}`)
  }
  if (slug.includes('..') || slug.includes('\\') || slug.startsWith('/')) {
    throw new Error(`slug 路径不安全: ${slug}`)
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug) && !slug.includes('--')) {
    throw new Error(`slug 格式无效: ${slug}`)
  }
}

export function resolveInsideWorkspace(workspacePath: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  if (path.isAbsolute(normalized) || normalized.startsWith('/')) {
    throw new Error(`路径不允许绝对路径: ${relativePath}`)
  }
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error(`路径不允许 traversal: ${relativePath}`)
  }
  const abs = path.resolve(workspacePath, normalized)
  const root = path.resolve(workspacePath)
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error(`路径越界: ${relativePath}`)
  }
  return abs
}

export async function assertNotSymlink(filePath: string): Promise<void> {
  const stat = await fs.lstat(filePath)
  if (stat.isSymbolicLink()) {
    throw new Error(`不允许符号链接: ${filePath}`)
  }
}

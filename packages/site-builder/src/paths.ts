import path from 'node:path'
import { SITE_PATHS } from '@olps/sync'

export { SITE_PATHS }

/** 旧 API 预览仍读取该相对路径；与 SITE_PATHS.publishConfig 相同 */
export const PUBLISH_CONFIG_FILE = SITE_PATHS.publishConfig

export const PUBLIC_DIR = SITE_PATHS.publicDir
export const MANIFEST_FILE = SITE_PATHS.manifest

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
  if (slug.includes('--')) {
    throw new Error(`slug 不允许包含 --: ${slug}`)
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(slug)) {
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

export const SITE_PATHS = {
  manifest: 'olps.manifest.json',
  siteSettings: 'source/site-settings.json',
  pagesDir: 'source/pages',
  publicDir: 'public',
  assetsDir: 'assets',
} as const

export function pageJsonPath(pageId: string): string {
  return `${SITE_PATHS.pagesDir}/${pageId}.json`
}

export function assertSafeRelativePath(relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, '/')
  if (pathIsAbsolute(normalized)) {
    throw new Error(`路径不允许为绝对路径: ${relativePath}`)
  }
  const segments = normalized.split('/')
  for (const segment of segments) {
    if (segment === '..') {
      throw new Error(`路径不允许包含 ..: ${relativePath}`)
    }
    if (segment.toLowerCase() === '.git') {
      throw new Error(`路径不允许访问 .git: ${relativePath}`)
    }
  }
}

function pathIsAbsolute(p: string): boolean {
  if (p.startsWith('/')) return true
  return /^[A-Za-z]:/.test(p)
}

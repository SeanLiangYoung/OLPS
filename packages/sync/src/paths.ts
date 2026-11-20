export const SITE_PATHS = {
  manifest: 'olps.manifest.json',
  siteSettings: 'source/site-settings.json',
  appearance: 'source/appearance.json',
  pluginsConfig: 'source/plugins.json',
  publishConfig: 'source/publish-config.json',
  redirects: 'source/redirects.json',
  pagesDir: 'source/pages',
  collectionsDir: 'source/collections',
  mediaDir: 'source/media',
  i18nDir: 'source/i18n',
  uploadsDir: 'assets/uploads',
  assetsDir: 'assets',
  themesDir: 'themes',
  pluginsDir: 'plugins',
  siteVerify: 'tools/site-verify.mjs',
  serverConfigDir: 'server-config',
  cacheDir: '.olps-cache',
  publicDir: 'public',
} as const

export function pageJsonPath(pageId: string): string {
  return `${SITE_PATHS.pagesDir}/${pageId}.json`
}

export function pageMetaPath(pageId: string): string {
  return `${SITE_PATHS.pagesDir}/${pageId}/page.json`
}

export function pageLocalePath(pageId: string, locale: string): string {
  return `${SITE_PATHS.pagesDir}/${pageId}/${locale}.json`
}

export function collectionDefinitionPath(collectionId: string): string {
  return `${SITE_PATHS.collectionsDir}/${collectionId}.json`
}

export function mediaMetaPath(mediaId: string): string {
  return `${SITE_PATHS.mediaDir}/${mediaId}.json`
}

export function i18nLocalePath(locale: string): string {
  return `${SITE_PATHS.i18nDir}/${locale}.json`
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

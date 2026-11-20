import {
  assertValidSchema,
  type AppearanceConfig,
  type CollectionDefinition,
  type CollectionIndexLocaleFile,
  type GroupLocaleFile,
  type GroupMeta,
  type ItemLocaleFile,
  type ItemMeta,
  type ManagedSiteSettings,
  type MediaMeta,
  type PageLocaleFile,
  type PageMeta,
  type PluginsConfig,
  type PublishConfig,
  type RedirectsConfig,
} from '@olps/domain'
import type { SourceReader } from './source-reader.js'

export type SitePage = {
  meta: PageMeta
  locales: Record<string, PageLocaleFile>
  directoryPath: string
}

export type SiteGroup = {
  collectionId: string
  meta: GroupMeta
  locales: Record<string, GroupLocaleFile>
  directoryPath: string
}

export type SiteItem = {
  collectionId: string
  meta: ItemMeta
  locales: Record<string, ItemLocaleFile>
  directoryPath: string
}

export type SiteCollection = {
  definition: CollectionDefinition
  definitionPath: string
  indexLocales: Record<string, CollectionIndexLocaleFile>
  groups: SiteGroup[]
  items: SiteItem[]
}

export type SiteI18nFile = {
  schemaVersion: 1
  strings: Record<string, string>
}

export type SiteModel = {
  settings: ManagedSiteSettings
  appearance: AppearanceConfig
  plugins: PluginsConfig
  redirects: RedirectsConfig
  publishConfig: PublishConfig
  pages: SitePage[]
  collections: SiteCollection[]
  media: MediaMeta[]
  i18n: Record<string, SiteI18nFile>
}

async function readJson(
  reader: SourceReader,
  relativePath: string,
): Promise<unknown> {
  const text = await reader.readText(relativePath)
  return JSON.parse(text) as unknown
}

async function readValidatedJson<T>(
  reader: SourceReader,
  relativePath: string,
  schemaName: Parameters<typeof assertValidSchema>[0],
  context?: Parameters<typeof assertValidSchema>[3],
): Promise<T> {
  const value = await readJson(reader, relativePath)
  assertValidSchema(schemaName, value, relativePath, context)
  return value as T
}

async function listOrEmpty(
  reader: SourceReader,
  relativePath: string,
): Promise<string[]> {
  try {
    return await reader.list(relativePath)
  } catch (error) {
    if (isMissingPathError(error)) {
      return []
    }
    throw error
  }
}

function isMissingPathError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const code = (error as { code?: string }).code
  return code === 'ENOENT'
}

function isLocaleFileName(name: string): boolean {
  return name.endsWith('.json') && name !== 'page.json' && name !== 'group.json' && name !== 'item.json'
}

function localeFromFileName(name: string): string {
  return name.slice(0, -'.json'.length)
}

async function loadPages(reader: SourceReader): Promise<SitePage[]> {
  const pageIds = await listOrEmpty(reader, 'source/pages')
  const pages: SitePage[] = []

  for (const pageId of pageIds) {
    if (pageId.endsWith('.json') || pageId.startsWith('.')) {
      continue
    }
    const directoryPath = `source/pages/${pageId}`
    const meta = await readValidatedJson<PageMeta>(
      reader,
      `${directoryPath}/page.json`,
      'page-meta',
    )
    const entries = await reader.list(directoryPath)
    const locales: Record<string, PageLocaleFile> = {}
    for (const entry of entries) {
      if (!isLocaleFileName(entry)) {
        continue
      }
      const locale = localeFromFileName(entry)
      locales[locale] = await readValidatedJson<PageLocaleFile>(
        reader,
        `${directoryPath}/${entry}`,
        'page-locale',
        { pageRole: meta.role },
      )
    }
    pages.push({ meta, locales, directoryPath })
  }

  return pages
}

async function loadLocaleMap<T>(
  reader: SourceReader,
  directoryPath: string,
  schemaName: Parameters<typeof assertValidSchema>[0],
): Promise<Record<string, T>> {
  const entries = await listOrEmpty(reader, directoryPath)
  const locales: Record<string, T> = {}
  for (const entry of entries) {
    if (!isLocaleFileName(entry)) {
      continue
    }
    const locale = localeFromFileName(entry)
    locales[locale] = await readValidatedJson<T>(
      reader,
      `${directoryPath}/${entry}`,
      schemaName,
    )
  }
  return locales
}

async function loadCollection(
  reader: SourceReader,
  collectionId: string,
): Promise<SiteCollection> {
  const definitionPath = `source/collections/${collectionId}.json`
  const definition = await readValidatedJson<CollectionDefinition>(
    reader,
    definitionPath,
    'collection',
  )
  const indexLocales = await loadLocaleMap<CollectionIndexLocaleFile>(
    reader,
    `source/collections/${collectionId}/index`,
    'collection-index-locale',
  )

  const groupIds = await listOrEmpty(
    reader,
    `source/collections/${collectionId}/groups`,
  )
  const groups: SiteGroup[] = []
  for (const groupId of groupIds) {
    if (groupId.startsWith('.')) {
      continue
    }
    const directoryPath = `source/collections/${collectionId}/groups/${groupId}`
    const meta = await readValidatedJson<GroupMeta>(
      reader,
      `${directoryPath}/group.json`,
      'group-meta',
    )
    const locales = await loadLocaleMap<GroupLocaleFile>(
      reader,
      directoryPath,
      'group-locale',
    )
    groups.push({ collectionId, meta, locales, directoryPath })
  }

  const itemIds = await listOrEmpty(
    reader,
    `source/collections/${collectionId}/items`,
  )
  const items: SiteItem[] = []
  for (const itemId of itemIds) {
    if (itemId.startsWith('.')) {
      continue
    }
    const directoryPath = `source/collections/${collectionId}/items/${itemId}`
    const meta = await readValidatedJson<ItemMeta>(
      reader,
      `${directoryPath}/item.json`,
      'item-meta',
    )
    const locales = await loadLocaleMap<ItemLocaleFile>(
      reader,
      directoryPath,
      'item-locale',
    )
    items.push({ collectionId, meta, locales, directoryPath })
  }

  return {
    definition,
    definitionPath,
    indexLocales,
    groups,
    items,
  }
}

async function loadCollections(reader: SourceReader): Promise<SiteCollection[]> {
  const entries = await listOrEmpty(reader, 'source/collections')
  const collections: SiteCollection[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue
    }
    const collectionId = entry.slice(0, -'.json'.length)
    collections.push(await loadCollection(reader, collectionId))
  }
  return collections
}

async function loadMedia(reader: SourceReader): Promise<MediaMeta[]> {
  const entries = await listOrEmpty(reader, 'source/media')
  const media: MediaMeta[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue
    }
    media.push(await readValidatedJson<MediaMeta>(
      reader,
      `source/media/${entry}`,
      'media',
    ))
  }
  return media
}

async function loadI18n(reader: SourceReader): Promise<Record<string, SiteI18nFile>> {
  const entries = await listOrEmpty(reader, 'source/i18n')
  const i18n: Record<string, SiteI18nFile> = {}
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue
    }
    const locale = localeFromFileName(entry)
    i18n[locale] = await readValidatedJson<SiteI18nFile>(
      reader,
      `source/i18n/${entry}`,
      'i18n',
    )
  }
  return i18n
}

export async function loadSiteModel(reader: SourceReader): Promise<SiteModel> {
  const settings = await readValidatedJson<ManagedSiteSettings>(
    reader,
    'source/site-settings.json',
    'site-settings',
  )
  const appearance = await readValidatedJson<AppearanceConfig>(
    reader,
    'source/appearance.json',
    'appearance',
  )
  const plugins = await readValidatedJson<PluginsConfig>(
    reader,
    'source/plugins.json',
    'plugins',
  )
  const redirects = await readValidatedJson<RedirectsConfig>(
    reader,
    'source/redirects.json',
    'redirects',
  )
  const publishConfig = await readValidatedJson<PublishConfig>(
    reader,
    'source/publish-config.json',
    'publish-config',
  )
  const pages = await loadPages(reader)
  const collections = await loadCollections(reader)
  const media = await loadMedia(reader)
  const i18n = await loadI18n(reader)

  return {
    settings,
    appearance,
    plugins,
    redirects,
    publishConfig,
    pages,
    collections,
    media,
    i18n,
  }
}

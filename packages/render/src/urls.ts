import type { SiteCollection, SiteGroup, SiteItem, SiteModel, SitePage } from './site-model.js'

export const RESERVED_SEGMENT = 'page'

export class UrlConflictError extends Error {
  readonly conflicts: UrlConflict[]

  constructor(conflicts: UrlConflict[]) {
    const details = conflicts.map((conflict) => {
      const owners = conflict.owners
        .map((owner) => `${owner.kind}:${owner.id} (${owner.path})`)
        .join(' ; ')
      return `${conflict.url} ← ${owners}`
    }).join(' | ')
    super(`地址冲突：${details}`)
    this.name = 'UrlConflictError'
    this.conflicts = conflicts
  }
}

export type UrlOwner = {
  kind: 'page' | 'collection' | 'group' | 'item' | 'pagination-reserved'
  id: string
  path: string
}

export type UrlConflict = {
  url: string
  owners: UrlOwner[]
}

export function homeUrl(locale: string): string {
  return `/${locale}/`
}

export function pageUrl(locale: string, slug: string): string {
  if (slug === '') {
    return homeUrl(locale)
  }
  return `/${locale}/${slug}/`
}

export function notFoundUrl(locale: string): string {
  return `/${locale}/404.html`
}

export function collectionIndexUrl(locale: string, prefix: string): string {
  return `/${locale}/${prefix}/`
}

export function groupUrl(
  locale: string,
  prefix: string,
  slugPath: string[],
): string {
  if (slugPath.length === 0) {
    return collectionIndexUrl(locale, prefix)
  }
  return `/${locale}/${prefix}/${slugPath.join('/')}/`
}

export function itemUrl(locale: string, prefix: string, slug: string): string {
  return `/${locale}/${prefix}/${slug}/`
}

export function paginationUrl(listUrl: string, pageNumber: number): string {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`分页页码无效：${pageNumber}`)
  }
  const base = listUrl.endsWith('/') ? listUrl : `${listUrl}/`
  return `${base}${RESERVED_SEGMENT}/${pageNumber}/`
}

export function relativeUrl(fromUrl: string, toUrl: string): string {
  const fromDirectory = directoryOf(fromUrl)
  const toSegments = splitPublicPath(toUrl)
  const fromSegments = splitPublicPath(fromDirectory)

  let common = 0
  while (
    common < fromSegments.length
    && common < toSegments.length
    && fromSegments[common] === toSegments[common]
  ) {
    common += 1
  }

  const upCount = fromSegments.length - common
  const down = toSegments.slice(common)
  const parts = [
    ...Array.from({ length: upCount }, () => '..'),
    ...down,
  ]

  if (parts.length === 0) {
    return './'
  }

  const joined = parts.join('/')
  if (toUrl.endsWith('/')) {
    return `${joined}/`
  }
  return joined
}

function directoryOf(url: string): string {
  if (url.endsWith('/')) {
    return url
  }
  const lastSlash = url.lastIndexOf('/')
  if (lastSlash <= 0) {
    return '/'
  }
  return url.slice(0, lastSlash + 1)
}

function splitPublicPath(url: string): string[] {
  const normalized = url.startsWith('/') ? url.slice(1) : url
  if (normalized === '' || normalized === '/') {
    return []
  }
  const withoutTrailing = normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
  if (withoutTrailing === '') {
    return []
  }
  return withoutTrailing.split('/')
}

function groupSlugPath(
  collection: SiteCollection,
  group: SiteGroup,
  locale: string,
): string[] | null {
  const slugs: string[] = []
  let current: SiteGroup | undefined = group
  while (current) {
    const localeFile = current.locales[locale]
    if (!localeFile) {
      return null
    }
    slugs.unshift(localeFile.slug)
    const parentGroupId: string | null = current.meta.parentGroupId
    if (parentGroupId === null) {
      break
    }
    const parentId: string = parentGroupId
    current = collection.groups.find((candidate) => candidate.meta.groupId === parentId)
    if (!current) {
      throw new Error(
        `分组缺少父级：${group.directoryPath} parentGroupId=${parentId}`,
      )
    }
  }
  return slugs
}

type RegisteredUrl = {
  url: string
  owner: UrlOwner
}

function collectLocaleUrls(model: SiteModel, locale: string): RegisteredUrl[] {
  const registered: RegisteredUrl[] = []

  for (const page of model.pages) {
    const localeFile = page.locales[locale]
    if (!localeFile) {
      continue
    }
    if (page.meta.role === 'not-found') {
      registered.push({
        url: notFoundUrl(locale),
        owner: {
          kind: 'page',
          id: page.meta.pageId,
          path: `${page.directoryPath}/${locale}.json`,
        },
      })
      continue
    }
    registered.push({
      url: pageUrl(locale, localeFile.slug),
      owner: {
        kind: 'page',
        id: page.meta.pageId,
        path: `${page.directoryPath}/${locale}.json`,
      },
    })
  }

  for (const collection of model.collections) {
    const prefix = collection.definition.prefix
    if (collection.indexLocales[locale]) {
      registered.push({
        url: collectionIndexUrl(locale, prefix),
        owner: {
          kind: 'collection',
          id: collection.definition.collectionId,
          path: `${collection.definitionPath.replace(/\.json$/, '')}/index/${locale}.json`,
        },
      })
    }

    for (const group of collection.groups) {
      const slugPath = groupSlugPath(collection, group, locale)
      if (!slugPath) {
        continue
      }
      registered.push({
        url: groupUrl(locale, prefix, slugPath),
        owner: {
          kind: 'group',
          id: group.meta.groupId,
          path: `${group.directoryPath}/${locale}.json`,
        },
      })
    }

    for (const item of collection.items) {
      const localeFile = item.locales[locale]
      if (!localeFile) {
        continue
      }
      registered.push({
        url: itemUrl(locale, prefix, localeFile.slug),
        owner: {
          kind: 'item',
          id: item.meta.itemId,
          path: `${item.directoryPath}/${locale}.json`,
        },
      })
    }
  }

  return registered
}

function findPrefixPageConflicts(model: SiteModel, locale: string): UrlConflict[] {
  const prefixes = new Map(
    model.collections.map((collection) => [
      collection.definition.prefix,
      collection,
    ]),
  )
  const conflicts: UrlConflict[] = []

  for (const page of model.pages) {
    if (page.meta.role === 'home' || page.meta.role === 'not-found') {
      continue
    }
    const localeFile = page.locales[locale]
    if (!localeFile) {
      continue
    }
    const collection = prefixes.get(localeFile.slug)
    if (!collection) {
      continue
    }
    conflicts.push({
      url: pageUrl(locale, localeFile.slug),
      owners: [
        {
          kind: 'page',
          id: page.meta.pageId,
          path: `${page.directoryPath}/${locale}.json`,
        },
        {
          kind: 'collection',
          id: collection.definition.collectionId,
          path: collection.definitionPath,
        },
      ],
    })
  }

  return conflicts
}

function findFirstLevelItemConflicts(
  model: SiteModel,
  locale: string,
): UrlConflict[] {
  const conflicts: UrlConflict[] = []

  for (const collection of model.collections) {
    const firstLevelGroups = collection.groups.filter(
      (group) => group.meta.parentGroupId === null,
    )
    const groupBySlug = new Map<string, SiteGroup>()
    for (const group of firstLevelGroups) {
      const localeFile = group.locales[locale]
      if (!localeFile) {
        continue
      }
      groupBySlug.set(localeFile.slug, group)
    }

    for (const item of collection.items) {
      const localeFile = item.locales[locale]
      if (!localeFile) {
        continue
      }
      const group = groupBySlug.get(localeFile.slug)
      if (!group) {
        continue
      }
      conflicts.push({
        url: itemUrl(locale, collection.definition.prefix, localeFile.slug),
        owners: [
          {
            kind: 'item',
            id: item.meta.itemId,
            path: `${item.directoryPath}/${locale}.json`,
          },
          {
            kind: 'group',
            id: group.meta.groupId,
            path: `${group.directoryPath}/${locale}.json`,
          },
        ],
      })
    }
  }

  return conflicts
}

function findDuplicateUrlConflicts(registered: RegisteredUrl[]): UrlConflict[] {
  const byUrl = new Map<string, UrlOwner[]>()
  for (const entry of registered) {
    const owners = byUrl.get(entry.url) ?? []
    owners.push(entry.owner)
    byUrl.set(entry.url, owners)
  }

  const conflicts: UrlConflict[] = []
  for (const [url, owners] of byUrl) {
    const uniqueOwners = uniqueByPath(owners)
    if (uniqueOwners.length < 2) {
      continue
    }
    conflicts.push({ url, owners: uniqueOwners })
  }
  return conflicts
}

function findReservedSlugConflicts(model: SiteModel, locale: string): UrlConflict[] {
  const conflicts: UrlConflict[] = []
  for (const collection of model.collections) {
    for (const group of collection.groups) {
      const localeFile = group.locales[locale]
      if (!localeFile || localeFile.slug !== RESERVED_SEGMENT) {
        continue
      }
      conflicts.push({
        url: groupUrl(
          locale,
          collection.definition.prefix,
          groupSlugPath(collection, group, locale) ?? [localeFile.slug],
        ),
        owners: [
          {
            kind: 'pagination-reserved',
            id: group.meta.groupId,
            path: `${group.directoryPath}/${locale}.json`,
          },
        ],
      })
    }
    for (const item of collection.items) {
      const localeFile = item.locales[locale]
      if (!localeFile || localeFile.slug !== RESERVED_SEGMENT) {
        continue
      }
      conflicts.push({
        url: itemUrl(locale, collection.definition.prefix, localeFile.slug),
        owners: [
          {
            kind: 'pagination-reserved',
            id: item.meta.itemId,
            path: `${item.directoryPath}/${locale}.json`,
          },
        ],
      })
    }
  }
  return conflicts
}

function uniqueByPath(owners: UrlOwner[]): UrlOwner[] {
  const seen = new Set<string>()
  const result: UrlOwner[] = []
  for (const owner of owners) {
    const key = `${owner.kind}:${owner.id}:${owner.path}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(owner)
  }
  return result
}

export function collectUrlConflicts(model: SiteModel): UrlConflict[] {
  const locales = model.settings.locales.map((locale) => locale.code)
  const conflicts: UrlConflict[] = []

  for (const locale of locales) {
    const registered = collectLocaleUrls(model, locale)
    conflicts.push(
      ...findDuplicateUrlConflicts(registered),
      ...findPrefixPageConflicts(model, locale),
      ...findFirstLevelItemConflicts(model, locale),
      ...findReservedSlugConflicts(model, locale),
    )
  }

  return dedupeConflicts(conflicts)
}

function dedupeConflicts(conflicts: UrlConflict[]): UrlConflict[] {
  const seen = new Set<string>()
  const result: UrlConflict[] = []
  for (const conflict of conflicts) {
    const key = `${conflict.url}|${conflict.owners.map((owner) => owner.path).sort().join(',')}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(conflict)
  }
  return result
}

export function assertNoUrlConflicts(model: SiteModel): void {
  const conflicts = collectUrlConflicts(model)
  if (conflicts.length > 0) {
    throw new UrlConflictError(conflicts)
  }
}

export function absoluteUrlForPage(page: SitePage, locale: string): string | null {
  const localeFile = page.locales[locale]
  if (!localeFile) {
    return null
  }
  if (page.meta.role === 'not-found') {
    return notFoundUrl(locale)
  }
  return pageUrl(locale, localeFile.slug)
}

export function absoluteUrlForGroup(
  collection: SiteCollection,
  group: SiteGroup,
  locale: string,
): string | null {
  const slugPath = groupSlugPath(collection, group, locale)
  if (!slugPath) {
    return null
  }
  return groupUrl(locale, collection.definition.prefix, slugPath)
}

export function absoluteUrlForItem(
  collection: SiteCollection,
  item: SiteItem,
  locale: string,
): string | null {
  const localeFile = item.locales[locale]
  if (!localeFile) {
    return null
  }
  return itemUrl(locale, collection.definition.prefix, localeFile.slug)
}

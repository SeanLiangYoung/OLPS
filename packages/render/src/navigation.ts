import type { ContentStatus } from '@olps/domain'
import type { CollectionListItem } from './blocks/render-tree.js'
import type { SiteCollection, SiteGroup, SiteItem, SiteModel, SitePage } from './site-model.js'
import {
  absoluteUrlForGroup,
  absoluteUrlForItem,
  absoluteUrlForPage,
  collectionIndexUrl,
  homeUrl,
  paginationUrl,
} from './urls.js'

export type NavLink = {
  id: string
  title: string
  url: string
}

export type BreadcrumbItem = NavLink

export type ListData = {
  items: CollectionListItem[]
  pageNumber: number
  pageSize: number
  totalItems: number
  totalPages: number
  pageUrls: Array<{ page: number; url: string }>
}

export type RenderMode = 'publish' | 'preview' | 'canvas'

function isVisible(status: ContentStatus, mode: RenderMode): boolean {
  if (mode === 'publish') {
    return status === 'published'
  }
  return true
}

function requireCollection(model: SiteModel, collectionId: string): SiteCollection {
  const collection = model.collections.find(
    (entry) => entry.definition.collectionId === collectionId,
  )
  if (!collection) {
    throw new Error(`内容类型不存在：${collectionId}`)
  }
  return collection
}

function requireGroup(collection: SiteCollection, groupId: string): SiteGroup {
  const group = collection.groups.find((entry) => entry.meta.groupId === groupId)
  if (!group) {
    throw new Error(`分组不存在：${groupId}`)
  }
  return group
}

function requireItem(collection: SiteCollection, itemId: string): SiteItem {
  const item = collection.items.find((entry) => entry.meta.itemId === itemId)
  if (!item) {
    throw new Error(`条目不存在：${itemId}`)
  }
  return item
}

function findHomePage(model: SiteModel): SitePage | undefined {
  return model.pages.find((page) => page.meta.role === 'home')
}

function homeBreadcrumb(model: SiteModel, locale: string): BreadcrumbItem {
  const home = findHomePage(model)
  const title = home?.locales[locale]?.title ?? 'Home'
  return {
    id: home?.meta.pageId ?? 'home',
    title,
    url: homeUrl(locale),
  }
}

function groupChain(
  collection: SiteCollection,
  groupId: string,
): SiteGroup[] {
  const chain: SiteGroup[] = []
  let currentId: string | null = groupId
  while (currentId) {
    const group = requireGroup(collection, currentId)
    chain.unshift(group)
    currentId = group.meta.parentGroupId
  }
  return chain
}

export type BreadcrumbTarget =
  | { kind: 'page'; pageId: string; locale: string }
  | { kind: 'collection'; collectionId: string; locale: string }
  | { kind: 'group'; collectionId: string; groupId: string; locale: string }
  | { kind: 'item'; collectionId: string; itemId: string; locale: string }

export function buildBreadcrumbs(
  model: SiteModel,
  target: BreadcrumbTarget,
): BreadcrumbItem[] {
  const locale = target.locale
  const crumbs: BreadcrumbItem[] = [homeBreadcrumb(model, locale)]

  if (target.kind === 'page') {
    const page = model.pages.find((entry) => entry.meta.pageId === target.pageId)
    if (!page) {
      throw new Error(`页面不存在：${target.pageId}`)
    }
    if (page.meta.role === 'home') {
      return crumbs
    }
    const localeFile = page.locales[locale]
    if (!localeFile) {
      throw new Error(`页面缺少语言文件：${target.pageId} ${locale}`)
    }
    const url = absoluteUrlForPage(page, locale)
    if (!url) {
      throw new Error(`页面地址不可用：${target.pageId} ${locale}`)
    }
    crumbs.push({
      id: page.meta.pageId,
      title: localeFile.title,
      url,
    })
    return crumbs
  }

  const collection = requireCollection(model, target.collectionId)
  const indexLocale = collection.indexLocales[locale]
  if (!indexLocale) {
    throw new Error(`内容类型缺少语言文件：${target.collectionId} ${locale}`)
  }
  crumbs.push({
    id: collection.definition.collectionId,
    title: indexLocale.title,
    url: collectionIndexUrl(locale, collection.definition.prefix),
  })

  if (target.kind === 'collection') {
    return crumbs
  }

  if (target.kind === 'group') {
    for (const group of groupChain(collection, target.groupId)) {
      const localeFile = group.locales[locale]
      const url = absoluteUrlForGroup(collection, group, locale)
      if (!localeFile || !url) {
        throw new Error(`分组缺少语言文件或地址：${group.meta.groupId} ${locale}`)
      }
      crumbs.push({
        id: group.meta.groupId,
        title: localeFile.title,
        url,
      })
    }
    return crumbs
  }

  const item = requireItem(collection, target.itemId)
  if (item.meta.primaryGroupId) {
    for (const group of groupChain(collection, item.meta.primaryGroupId)) {
      const localeFile = group.locales[locale]
      const url = absoluteUrlForGroup(collection, group, locale)
      if (!localeFile || !url) {
        throw new Error(`分组缺少语言文件或地址：${group.meta.groupId} ${locale}`)
      }
      crumbs.push({
        id: group.meta.groupId,
        title: localeFile.title,
        url,
      })
    }
  }

  const itemLocale = item.locales[locale]
  const itemUrl = absoluteUrlForItem(collection, item, locale)
  if (!itemLocale || !itemUrl) {
    throw new Error(`条目缺少语言文件或地址：${item.meta.itemId} ${locale}`)
  }
  crumbs.push({
    id: item.meta.itemId,
    title: itemLocale.title,
    url: itemUrl,
  })
  return crumbs
}

function compareItems(
  left: SiteItem,
  right: SiteItem,
  locale: string,
  sort: 'manual' | 'publishedAt' | 'title',
): number {
  if (sort === 'manual') {
    return left.meta.order - right.meta.order
  }
  if (sort === 'publishedAt') {
    const leftTime = left.meta.publishedAt ?? ''
    const rightTime = right.meta.publishedAt ?? ''
    return leftTime.localeCompare(rightTime)
  }
  const leftTitle = left.locales[locale]?.title ?? ''
  const rightTitle = right.locales[locale]?.title ?? ''
  return leftTitle.localeCompare(rightTitle, locale)
}

function siblingsInPrimaryGroup(
  collection: SiteCollection,
  item: SiteItem,
  locale: string,
  mode: RenderMode,
  sort: 'manual' | 'publishedAt' | 'title' = 'manual',
): SiteItem[] {
  const primaryGroupId = item.meta.primaryGroupId
  const candidates = collection.items.filter((candidate) => {
    if (!isVisible(candidate.meta.status, mode)) {
      return false
    }
    if (!candidate.locales[locale]) {
      return false
    }
    if (primaryGroupId === null) {
      return candidate.meta.primaryGroupId === null
    }
    return candidate.meta.groupIds.includes(primaryGroupId)
  })
  return candidates.sort((left, right) => compareItems(left, right, locale, sort))
}

export function buildItemNavigation(
  model: SiteModel,
  options: {
    collectionId: string
    itemId: string
    locale: string
    mode: RenderMode
    sort?: 'manual' | 'publishedAt' | 'title'
  },
): {
  previous: NavLink | null
  next: NavLink | null
  related: NavLink[]
} {
  const collection = requireCollection(model, options.collectionId)
  const item = requireItem(collection, options.itemId)
  const sort = options.sort ?? 'manual'
  const siblings = siblingsInPrimaryGroup(
    collection,
    item,
    options.locale,
    options.mode,
    sort,
  )
  const index = siblings.findIndex((entry) => entry.meta.itemId === item.meta.itemId)
  if (index < 0) {
    throw new Error(`条目不在主分组序列中：${item.meta.itemId}`)
  }

  const toLink = (entry: SiteItem): NavLink => {
    const localeFile = entry.locales[options.locale]
    const url = absoluteUrlForItem(collection, entry, options.locale)
    if (!localeFile || !url) {
      throw new Error(`条目缺少语言文件或地址：${entry.meta.itemId}`)
    }
    return {
      id: entry.meta.itemId,
      title: localeFile.title,
      url,
    }
  }

  const previous = index > 0 ? toLink(siblings[index - 1]) : null
  const next = index < siblings.length - 1 ? toLink(siblings[index + 1]) : null
  const related = siblings
    .filter((entry) => entry.meta.itemId !== item.meta.itemId)
    .map(toLink)

  return { previous, next, related }
}

export type ListTarget =
  | {
      kind: 'collection'
      collectionId: string
      locale: string
      mode: RenderMode
      pageNumber: number
      pageSize: number
      sort: 'manual' | 'publishedAt' | 'title'
    }
  | {
      kind: 'group'
      collectionId: string
      groupId: string
      locale: string
      mode: RenderMode
      pageNumber: number
      pageSize: number
      sort: 'manual' | 'publishedAt' | 'title'
    }

function childGroups(
  collection: SiteCollection,
  parentGroupId: string | null,
  locale: string,
  mode: RenderMode,
): SiteGroup[] {
  return collection.groups
    .filter((group) => group.meta.parentGroupId === parentGroupId)
    .filter((group) => isVisible(group.meta.status, mode))
    .filter((group) => Boolean(group.locales[locale]))
    .sort((left, right) => left.meta.order - right.meta.order)
}

function itemsInGroup(
  collection: SiteCollection,
  groupId: string,
  locale: string,
  mode: RenderMode,
  sort: 'manual' | 'publishedAt' | 'title',
): SiteItem[] {
  return collection.items
    .filter((item) => item.meta.groupIds.includes(groupId))
    .filter((item) => isVisible(item.meta.status, mode))
    .filter((item) => Boolean(item.locales[locale]))
    .sort((left, right) => compareItems(left, right, locale, sort))
}

export function buildListData(model: SiteModel, target: ListTarget): ListData {
  const collection = requireCollection(model, target.collectionId)
  const listUrl =
    target.kind === 'collection'
      ? collectionIndexUrl(target.locale, collection.definition.prefix)
      : absoluteUrlForGroup(
          collection,
          requireGroup(collection, target.groupId),
          target.locale,
        )

  if (!listUrl) {
    throw new Error(`列表地址不可用：${target.collectionId}`)
  }

  let entries: CollectionListItem[] = []

  if (target.kind === 'collection') {
    const topGroups = childGroups(collection, null, target.locale, target.mode)
    if (topGroups.length > 0) {
      entries = topGroups.map((group) => {
        const localeFile = group.locales[target.locale]
        const url = absoluteUrlForGroup(collection, group, target.locale)
        if (!localeFile || !url) {
          throw new Error(`分组缺少语言文件或地址：${group.meta.groupId}`)
        }
        return { title: localeFile.title, url }
      })
    } else {
      entries = collection.items
        .filter((item) => isVisible(item.meta.status, target.mode))
        .filter((item) => Boolean(item.locales[target.locale]))
        .sort((left, right) => compareItems(left, right, target.locale, target.sort))
        .map((item) => {
          const localeFile = item.locales[target.locale]
          const url = absoluteUrlForItem(collection, item, target.locale)
          if (!localeFile || !url) {
            throw new Error(`条目缺少语言文件或地址：${item.meta.itemId}`)
          }
          return { title: localeFile.title, url }
        })
    }
  } else {
    const children = childGroups(
      collection,
      target.groupId,
      target.locale,
      target.mode,
    )
    if (children.length > 0) {
      entries = children.map((group) => {
        const localeFile = group.locales[target.locale]
        const url = absoluteUrlForGroup(collection, group, target.locale)
        if (!localeFile || !url) {
          throw new Error(`分组缺少语言文件或地址：${group.meta.groupId}`)
        }
        return { title: localeFile.title, url }
      })
    } else {
      entries = itemsInGroup(
        collection,
        target.groupId,
        target.locale,
        target.mode,
        target.sort,
      ).map((item) => {
        const localeFile = item.locales[target.locale]
        const url = absoluteUrlForItem(collection, item, target.locale)
        if (!localeFile || !url) {
          throw new Error(`条目缺少语言文件或地址：${item.meta.itemId}`)
        }
        return { title: localeFile.title, url }
      })
    }
  }

  const totalItems = entries.length
  const totalPages = Math.max(1, Math.ceil(totalItems / target.pageSize))
  if (target.pageNumber < 1 || target.pageNumber > totalPages) {
    throw new Error(`分页页码超出范围：${target.pageNumber}/${totalPages}`)
  }
  const start = (target.pageNumber - 1) * target.pageSize
  const items = entries.slice(start, start + target.pageSize)

  const pageUrls: Array<{ page: number; url: string }> = []
  for (let page = 1; page <= totalPages; page += 1) {
    pageUrls.push({
      page,
      url: page === 1 ? listUrl : paginationUrl(listUrl, page),
    })
  }

  return {
    items,
    pageNumber: target.pageNumber,
    pageSize: target.pageSize,
    totalItems,
    totalPages,
    pageUrls,
  }
}

export function resolveCollectionListItems(
  model: SiteModel,
  options: {
    locale: string
    mode: RenderMode
    props: Record<string, unknown>
    current:
      | { kind: 'collection'; collectionId: string; pageNumber?: number }
      | { kind: 'group'; collectionId: string; groupId: string; pageNumber?: number }
      | { kind: 'page' }
      | { kind: 'item' }
  },
): CollectionListItem[] {
  const pageSize =
    typeof options.props.pageSize === 'number' ? options.props.pageSize : 10
  const sort =
    options.props.sort === 'publishedAt' || options.props.sort === 'title'
      ? options.props.sort
      : 'manual'
  const pageNumber = options.current.kind === 'collection' || options.current.kind === 'group'
    ? options.current.pageNumber ?? 1
    : 1

  if (options.props.source === 'current') {
    if (options.current.kind === 'collection') {
      return buildListData(model, {
        kind: 'collection',
        collectionId: options.current.collectionId,
        locale: options.locale,
        mode: options.mode,
        pageNumber,
        pageSize,
        sort,
      }).items
    }
    if (options.current.kind === 'group') {
      return buildListData(model, {
        kind: 'group',
        collectionId: options.current.collectionId,
        groupId: options.current.groupId,
        locale: options.locale,
        mode: options.mode,
        pageNumber,
        pageSize,
        sort,
      }).items
    }
    throw new Error('source=current 仅用于总列表页或分组页')
  }

  const collectionId = options.props.collectionId
  if (typeof collectionId !== 'string' || collectionId.length === 0) {
    throw new Error('collection-list 缺少 collectionId')
  }
  return buildListData(model, {
    kind: 'collection',
    collectionId,
    locale: options.locale,
    mode: options.mode,
    pageNumber: 1,
    pageSize,
    sort,
  }).items
}

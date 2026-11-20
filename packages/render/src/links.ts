import type { ContentRef, ContentStatus } from '@olps/domain'
import type { SiteCollection, SiteModel, SitePage } from './site-model.js'
import {
  absoluteUrlForGroup,
  absoluteUrlForItem,
  absoluteUrlForPage,
  collectionIndexUrl,
  homeUrl,
  relativeUrl,
} from './urls.js'

export type LinkResolveMode = 'publish' | 'preview' | 'canvas'

export type ResolveContentRefOptions = {
  locale: string
  fromUrl: string
  mode: LinkResolveMode
}

export class ContentRefResolveError extends Error {
  readonly ref: ContentRef
  readonly objectPath: string

  constructor(message: string, ref: ContentRef, objectPath: string) {
    super(`${objectPath}: ${message}`)
    this.name = 'ContentRefResolveError'
    this.ref = ref
    this.objectPath = objectPath
  }
}

function isPublishMode(mode: LinkResolveMode): boolean {
  return mode === 'publish'
}

function ensurePublished(
  status: ContentStatus,
  mode: LinkResolveMode,
  ref: ContentRef,
  objectPath: string,
): void {
  if (!isPublishMode(mode)) {
    return
  }
  if (status !== 'published') {
    throw new ContentRefResolveError(
      `对象未发布（status=${status}）`,
      ref,
      objectPath,
    )
  }
}

function findPage(model: SiteModel, pageId: string): SitePage | undefined {
  return model.pages.find((page) => page.meta.pageId === pageId)
}

function findCollection(
  model: SiteModel,
  collectionId: string,
): SiteCollection | undefined {
  return model.collections.find(
    (collection) => collection.definition.collectionId === collectionId,
  )
}

function resolvePage(
  model: SiteModel,
  ref: ContentRef & { ref: 'page' },
  options: ResolveContentRefOptions,
): string {
  const page = findPage(model, ref.id)
  if (!page) {
    throw new ContentRefResolveError(
      `页面不存在：${ref.id}`,
      ref,
      `content-ref/page/${ref.id}`,
    )
  }

  ensurePublished(page.meta.status, options.mode, ref, `${page.directoryPath}/page.json`)

  const absolute = absoluteUrlForPage(page, options.locale)
  if (absolute) {
    return relativeUrl(options.fromUrl, absolute)
  }

  if (!isPublishMode(options.mode)) {
    return relativeUrl(options.fromUrl, homeUrl(options.locale))
  }

  throw new ContentRefResolveError(
    `缺少语言文件：${options.locale}`,
    ref,
    page.directoryPath,
  )
}

function resolveCollection(
  model: SiteModel,
  ref: ContentRef & { ref: 'collection' },
  options: ResolveContentRefOptions,
): string {
  const collection = findCollection(model, ref.id)
  if (!collection) {
    throw new ContentRefResolveError(
      `内容类型不存在：${ref.id}`,
      ref,
      `content-ref/collection/${ref.id}`,
    )
  }

  ensurePublished(
    collection.definition.status,
    options.mode,
    ref,
    collection.definitionPath,
  )

  if (collection.indexLocales[options.locale]) {
    return relativeUrl(
      options.fromUrl,
      collectionIndexUrl(options.locale, collection.definition.prefix),
    )
  }

  if (!isPublishMode(options.mode)) {
    return relativeUrl(options.fromUrl, homeUrl(options.locale))
  }

  throw new ContentRefResolveError(
    `缺少语言文件：${options.locale}`,
    ref,
    `source/collections/${collection.definition.collectionId}/index`,
  )
}

function resolveGroup(
  model: SiteModel,
  ref: ContentRef & { ref: 'group' },
  options: ResolveContentRefOptions,
): string {
  for (const collection of model.collections) {
    const group = collection.groups.find((candidate) => candidate.meta.groupId === ref.id)
    if (!group) {
      continue
    }

    ensurePublished(
      collection.definition.status,
      options.mode,
      ref,
      collection.definitionPath,
    )
    ensurePublished(
      group.meta.status,
      options.mode,
      ref,
      `${group.directoryPath}/group.json`,
    )

    const absolute = absoluteUrlForGroup(collection, group, options.locale)
    if (absolute) {
      return relativeUrl(options.fromUrl, absolute)
    }

    if (!isPublishMode(options.mode)) {
      return relativeUrl(options.fromUrl, homeUrl(options.locale))
    }

    throw new ContentRefResolveError(
      `缺少语言文件：${options.locale}`,
      ref,
      group.directoryPath,
    )
  }

  throw new ContentRefResolveError(
    `分组不存在：${ref.id}`,
    ref,
    `content-ref/group/${ref.id}`,
  )
}

function resolveItem(
  model: SiteModel,
  ref: ContentRef & { ref: 'item' },
  options: ResolveContentRefOptions,
): string {
  for (const collection of model.collections) {
    const item = collection.items.find((candidate) => candidate.meta.itemId === ref.id)
    if (!item) {
      continue
    }

    ensurePublished(
      collection.definition.status,
      options.mode,
      ref,
      collection.definitionPath,
    )
    ensurePublished(
      item.meta.status,
      options.mode,
      ref,
      `${item.directoryPath}/item.json`,
    )

    const absolute = absoluteUrlForItem(collection, item, options.locale)
    if (absolute) {
      return relativeUrl(options.fromUrl, absolute)
    }

    if (!isPublishMode(options.mode)) {
      return relativeUrl(options.fromUrl, homeUrl(options.locale))
    }

    throw new ContentRefResolveError(
      `缺少语言文件：${options.locale}`,
      ref,
      item.directoryPath,
    )
  }

  throw new ContentRefResolveError(
    `条目不存在：${ref.id}`,
    ref,
    `content-ref/item/${ref.id}`,
  )
}

export function resolveContentRef(
  model: SiteModel,
  ref: ContentRef,
  options: ResolveContentRefOptions,
): string {
  if (ref.ref === 'page') {
    return resolvePage(model, ref, options)
  }
  if (ref.ref === 'collection') {
    return resolveCollection(model, ref, options)
  }
  if (ref.ref === 'group') {
    return resolveGroup(model, ref, options)
  }
  return resolveItem(model, ref, options)
}

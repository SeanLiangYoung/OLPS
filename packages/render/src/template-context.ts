import type { LinkValue } from '@olps/domain'
import { resolveContentRef, type LinkResolveMode } from './links.js'
import {
  buildBreadcrumbs,
  buildItemNavigation,
  buildListData,
  type BreadcrumbItem,
  type ListData,
  type NavLink,
  type RenderMode,
} from './navigation.js'
import type { SiteModel } from './site-model.js'
import type { SourceReader } from './source-reader.js'
import { absolutePathForTarget } from './structured-data.js'
import { absoluteUrlForPage, homeUrl, relativeUrl } from './urls.js'

export type TemplateContextTarget =
  | { kind: 'page'; pageId: string }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'group'; collectionId: string; groupId: string }
  | { kind: 'item'; collectionId: string; itemId: string }

export type BuildTemplateContextOptions = TemplateContextTarget & {
  locale: string
  mode: RenderMode
  reader: SourceReader
  contentHtml: string
  pageNumber?: number
}

export type ResolvedMenuItem = {
  menuItemId: string
  label: string
  url: string
  children: ResolvedMenuItem[]
}

export type TemplateContext = {
  site: {
    siteName: string
    siteUrl: string
    company: SiteModel['settings']['company']
    socialLinks: SiteModel['settings']['socialLinks']
  }
  locale: { code: string; dir: string }
  locales: Array<{ code: string; dir: string }>
  alternates: Array<{ code: string; dir: string; url: string; name: string }>
  appearance: Record<string, unknown>
  menus: Record<string, ResolvedMenuItem[]>
  legalLinks: Array<{ title: string; url: string }>
  page?: {
    id: string
    title: string
    summary: string
    slug: string
    role: string | null
  }
  collection?: {
    id: string
    title: string
    summary: string
    prefix: string
  }
  group?: {
    id: string
    title: string
    summary: string
    slug: string
  }
  item?: {
    id: string
    title: string
    summary: string
    slug: string
  }
  content: string
  breadcrumbs?: BreadcrumbItem[]
  previous?: NavLink | null
  next?: NavLink | null
  related?: NavLink[]
  list?: ListData
}

function resolveMenuItems(
  model: SiteModel,
  items: SiteModel['appearance']['menus'][string],
  locale: string,
  fromUrl: string,
  mode: LinkResolveMode,
): ResolvedMenuItem[] {
  return items.map((item) => {
    const label = item.label[locale] ?? item.label[model.settings.defaultLocale]
    if (!label) {
      throw new Error(`菜单项缺少标签：${item.menuItemId} locale=${locale}`)
    }
    let url: string
    if (item.link.kind === 'external') {
      url = item.link.url
    } else {
      url = resolveContentRef(model, item.link.target, {
        locale,
        fromUrl,
        mode,
      })
    }
    return {
      menuItemId: item.menuItemId,
      label,
      url,
      children: resolveMenuItems(model, item.children, locale, fromUrl, mode),
    }
  })
}

function localeDisplayName(locale: string): string {
  return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
}

export async function buildTemplateContext(
  model: SiteModel,
  options: BuildTemplateContextOptions,
): Promise<TemplateContext> {
  const localeDef = model.settings.locales.find((entry) => entry.code === options.locale)
  if (!localeDef) {
    throw new Error(`语言未启用：${options.locale}`)
  }

  const absolutePath = absolutePathForTarget(model, {
    ...options,
    mode: options.mode,
  })
  const fromUrl = absolutePath

  const menus: Record<string, ResolvedMenuItem[]> = {}
  for (const [menuId, items] of Object.entries(model.appearance.menus)) {
    menus[menuId] = resolveMenuItems(
      model,
      items,
      options.locale,
      fromUrl,
      options.mode,
    )
  }

  const alternates = model.settings.locales.map((entry) => {
    let path: string
    try {
      path = absolutePathForTarget(model, {
        ...options,
        locale: entry.code,
        mode: options.mode,
      })
    } catch {
      path = homeUrl(entry.code)
    }
    return {
      code: entry.code,
      dir: entry.dir,
      url: relativeUrl(fromUrl, path),
      name: localeDisplayName(entry.code),
    }
  })

  const context: TemplateContext = {
    site: {
      siteName: model.settings.siteName,
      siteUrl: model.settings.siteUrl,
      company: model.settings.company,
      socialLinks: model.settings.socialLinks,
    },
    locale: { code: localeDef.code, dir: localeDef.dir },
    locales: model.settings.locales.map((entry) => ({
      code: entry.code,
      dir: entry.dir,
    })),
    alternates,
    appearance: model.appearance.themeSettings,
    menus,
    legalLinks: model.pages.flatMap(page => {
      if (!['privacy', 'terms', 'cookies'].includes(page.meta.role ?? '')) return []
      if (options.mode === 'publish' && page.meta.status !== 'published') return []
      const document = page.locales[options.locale]
      const url = absoluteUrlForPage(page, options.locale)
      return document && url ? [{ title: document.title, url: relativeUrl(fromUrl, url) }] : []
    }),
    content: options.contentHtml,
  }

  if (options.kind === 'page') {
    const page = model.pages.find((entry) => entry.meta.pageId === options.pageId)
    if (!page) {
      throw new Error(`页面不存在：${options.pageId}`)
    }
    const localeFile = page.locales[options.locale]
    if (!localeFile) {
      throw new Error(`页面缺少语言文件：${options.pageId} ${options.locale}`)
    }
    context.page = {
      id: page.meta.pageId,
      title: localeFile.title,
      summary: localeFile.summary,
      slug: localeFile.slug,
      role: page.meta.role,
    }
    if (page.meta.role !== 'home' && page.meta.role !== 'not-found') {
      context.breadcrumbs = buildBreadcrumbs(model, {
        kind: 'page',
        pageId: options.pageId,
        locale: options.locale,
      })
    }
    return context
  }

  const collection = model.collections.find(
    (entry) => entry.definition.collectionId === options.collectionId,
  )
  if (!collection) {
    throw new Error(`内容类型不存在：${options.collectionId}`)
  }

  if (options.kind === 'collection') {
    const localeFile = collection.indexLocales[options.locale]
    if (!localeFile) {
      throw new Error(`内容类型缺少语言文件：${options.collectionId}`)
    }
    context.collection = {
      id: collection.definition.collectionId,
      title: localeFile.title,
      summary: localeFile.summary,
      prefix: collection.definition.prefix,
    }
    context.breadcrumbs = buildBreadcrumbs(model, {
      kind: 'collection',
      collectionId: options.collectionId,
      locale: options.locale,
    })
    context.list = buildListData(model, {
      kind: 'collection',
      collectionId: options.collectionId,
      locale: options.locale,
      mode: options.mode,
      pageNumber: options.pageNumber ?? 1,
      pageSize: 24,
      sort: 'manual',
    })
    return context
  }

  if (options.kind === 'group') {
    const group = collection.groups.find((entry) => entry.meta.groupId === options.groupId)
    if (!group) {
      throw new Error(`分组不存在：${options.groupId}`)
    }
    const localeFile = group.locales[options.locale]
    if (!localeFile) {
      throw new Error(`分组缺少语言文件：${options.groupId}`)
    }
    context.group = {
      id: group.meta.groupId,
      title: localeFile.title,
      summary: localeFile.summary,
      slug: localeFile.slug,
    }
    context.breadcrumbs = buildBreadcrumbs(model, {
      kind: 'group',
      collectionId: options.collectionId,
      groupId: options.groupId,
      locale: options.locale,
    })
    context.list = buildListData(model, {
      kind: 'group',
      collectionId: options.collectionId,
      groupId: options.groupId,
      locale: options.locale,
      mode: options.mode,
      pageNumber: options.pageNumber ?? 1,
      pageSize: 24,
      sort: 'manual',
    })
    return context
  }

  const item = collection.items.find((entry) => entry.meta.itemId === options.itemId)
  if (!item) {
    throw new Error(`条目不存在：${options.itemId}`)
  }
  const localeFile = item.locales[options.locale]
  if (!localeFile) {
    throw new Error(`条目缺少语言文件：${options.itemId}`)
  }
  context.item = {
    id: item.meta.itemId,
    title: localeFile.title,
    summary: localeFile.summary,
    slug: localeFile.slug,
  }
  context.breadcrumbs = buildBreadcrumbs(model, {
    kind: 'item',
    collectionId: options.collectionId,
    itemId: options.itemId,
    locale: options.locale,
  })
  const navigation = buildItemNavigation(model, {
    collectionId: options.collectionId,
    itemId: options.itemId,
    locale: options.locale,
    mode: options.mode,
  })
  context.previous = navigation.previous
  context.next = navigation.next
  context.related = navigation.related
  return context
}

export function resolveLinkValue(
  model: SiteModel,
  value: unknown,
  options: { locale: string; fromUrl: string; mode: LinkResolveMode },
): string {
  if (
    typeof value === 'object'
    && value !== null
    && 'kind' in value
  ) {
    const link = value as LinkValue
    if (link.kind === 'external') {
      return link.url
    }
    return resolveContentRef(model, link.target, options)
  }
  throw new Error(`无法解析链接：${JSON.stringify(value)}`)
}

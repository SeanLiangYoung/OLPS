import type { ManagedSeoFields, MediaRef } from '@olps/domain'
import type { RenderMode } from './navigation.js'
import type { SiteCollection, SiteModel, SitePage } from './site-model.js'
import {
  absoluteUrlForGroup,
  absoluteUrlForItem,
  absoluteUrlForPage,
  collectionIndexUrl,
  homeUrl,
  notFoundUrl,
} from './urls.js'

export type SeoHeadTarget =
  | { kind: 'page'; pageId: string; locale: string; mode: RenderMode }
  | { kind: 'collection'; collectionId: string; locale: string; mode: RenderMode }
  | {
      kind: 'group'
      collectionId: string
      groupId: string
      locale: string
      mode: RenderMode
    }
  | {
      kind: 'item'
      collectionId: string
      itemId: string
      locale: string
      mode: RenderMode
    }

export type HreflangEntry = {
  hreflang: string
  href: string
}

export type SeoHead = {
  title: string
  description: string
  canonical: string
  hreflang: HreflangEntry[]
  openGraph: {
    title: string
    description: string
    url: string
    locale: string
    image: string | null
  }
  twitter: {
    card: 'summary' | 'summary_large_image'
    title: string
    description: string
    image: string | null
  }
  noindex: boolean
}

function siteOrigin(model: SiteModel): string {
  return model.settings.siteUrl.replace(/\/$/, '')
}

function toAbsolute(model: SiteModel, path: string): string {
  return `${siteOrigin(model)}${path}`
}

function mediaUrl(model: SiteModel, ref: MediaRef | null): string | null {
  if (!ref) {
    return null
  }
  const media = model.media.find((entry) => entry.mediaId === ref.mediaId)
  if (!media) {
    return null
  }
  const path = media.path.startsWith('/') ? media.path : `/${media.path}`
  return toAbsolute(model, path)
}

function requirePage(model: SiteModel, pageId: string): SitePage {
  const page = model.pages.find((entry) => entry.meta.pageId === pageId)
  if (!page) {
    throw new Error(`页面不存在：${pageId}`)
  }
  return page
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

function pathForLocale(
  model: SiteModel,
  target: SeoHeadTarget,
  locale: string,
): string | null {
  if (target.kind === 'page') {
    const page = requirePage(model, target.pageId)
    return absoluteUrlForPage(page, locale)
  }
  const collection = requireCollection(model, target.collectionId)
  if (target.kind === 'collection') {
    if (!collection.indexLocales[locale]) {
      return null
    }
    return collectionIndexUrl(locale, collection.definition.prefix)
  }
  if (target.kind === 'group') {
    const group = collection.groups.find((entry) => entry.meta.groupId === target.groupId)
    if (!group) {
      throw new Error(`分组不存在：${target.groupId}`)
    }
    return absoluteUrlForGroup(collection, group, locale)
  }
  const item = collection.items.find((entry) => entry.meta.itemId === target.itemId)
  if (!item) {
    throw new Error(`条目不存在：${target.itemId}`)
  }
  return absoluteUrlForItem(collection, item, locale)
}

function resolveSeoFields(
  model: SiteModel,
  target: SeoHeadTarget,
): {
  seo: ManagedSeoFields
  cover: MediaRef | null
  role: string | null
} {
  if (target.kind === 'page') {
    const page = requirePage(model, target.pageId)
    const localeFile = page.locales[target.locale]
    if (!localeFile) {
      throw new Error(`页面缺少语言文件：${target.pageId} ${target.locale}`)
    }
    return {
      seo: localeFile.seo,
      cover: localeFile.cover,
      role: page.meta.role,
    }
  }

  const collection = requireCollection(model, target.collectionId)
  if (target.kind === 'collection') {
    const localeFile = collection.indexLocales[target.locale]
    if (!localeFile) {
      throw new Error(`内容类型缺少语言文件：${target.collectionId} ${target.locale}`)
    }
    return { seo: localeFile.seo, cover: localeFile.cover, role: null }
  }
  if (target.kind === 'group') {
    const group = collection.groups.find((entry) => entry.meta.groupId === target.groupId)
    if (!group) {
      throw new Error(`分组不存在：${target.groupId}`)
    }
    const localeFile = group.locales[target.locale]
    if (!localeFile) {
      throw new Error(`分组缺少语言文件：${target.groupId} ${target.locale}`)
    }
    return { seo: localeFile.seo, cover: localeFile.cover, role: null }
  }
  const item = collection.items.find((entry) => entry.meta.itemId === target.itemId)
  if (!item) {
    throw new Error(`条目不存在：${target.itemId}`)
  }
  const localeFile = item.locales[target.locale]
  if (!localeFile) {
    throw new Error(`条目缺少语言文件：${target.itemId} ${target.locale}`)
  }
  return { seo: localeFile.seo, cover: localeFile.cover, role: null }
}

function shouldNoindex(
  model: SiteModel,
  mode: RenderMode,
  role: string | null,
): boolean {
  if (mode !== 'publish') {
    return true
  }
  if (!model.settings.search.allowIndexing) {
    return true
  }
  return role === 'thank-you' || role === 'not-found'
}

export function buildSeoHead(model: SiteModel, target: SeoHeadTarget): SeoHead {
  const { seo, cover, role } = resolveSeoFields(model, target)
  const path = pathForLocale(model, target, target.locale)
  if (!path) {
    throw new Error(`当前语言缺少公开地址：${target.locale}`)
  }

  const canonicalPath =
    target.kind === 'page' && role === 'not-found'
      ? notFoundUrl(target.locale)
      : path
  const canonical = toAbsolute(model, canonicalPath)
  const image = mediaUrl(model, seo.ogImage)
    ?? mediaUrl(model, cover)
    ?? (model.settings.iconMediaId
      ? mediaUrl(model, { mediaId: model.settings.iconMediaId })
      : null)

  const hreflang: HreflangEntry[] = []
  for (const localeDef of model.settings.locales) {
    const localePath = pathForLocale(model, target, localeDef.code)
    if (!localePath) {
      continue
    }
    hreflang.push({
      hreflang: localeDef.code,
      href: toAbsolute(model, localePath),
    })
  }

  const defaultPath = pathForLocale(model, target, model.settings.defaultLocale)
    ?? homeUrl(model.settings.defaultLocale)
  hreflang.push({
    hreflang: 'x-default',
    href: toAbsolute(model, defaultPath),
  })

  return {
    title: seo.title,
    description: seo.description,
    canonical,
    hreflang,
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: canonical,
      locale: target.locale,
      image,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: seo.title,
      description: seo.description,
      image,
    },
    noindex: shouldNoindex(model, target.mode, role),
  }
}

export function renderSeoHeadHtml(head: SeoHead): string {
  const lines: string[] = [
    `<title>${escapeHtml(head.title)}</title>`,
    `<meta name="description" content="${escapeAttr(head.description)}">`,
    `<link rel="canonical" href="${escapeAttr(head.canonical)}">`,
  ]
  for (const entry of head.hreflang) {
    lines.push(
      `<link rel="alternate" hreflang="${escapeAttr(entry.hreflang)}" href="${escapeAttr(entry.href)}">`,
    )
  }
  lines.push(`<meta property="og:title" content="${escapeAttr(head.openGraph.title)}">`)
  lines.push(
    `<meta property="og:description" content="${escapeAttr(head.openGraph.description)}">`,
  )
  lines.push(`<meta property="og:url" content="${escapeAttr(head.openGraph.url)}">`)
  lines.push(`<meta property="og:locale" content="${escapeAttr(head.openGraph.locale)}">`)
  if (head.openGraph.image) {
    lines.push(`<meta property="og:image" content="${escapeAttr(head.openGraph.image)}">`)
  }
  lines.push(`<meta name="twitter:card" content="${escapeAttr(head.twitter.card)}">`)
  lines.push(`<meta name="twitter:title" content="${escapeAttr(head.twitter.title)}">`)
  lines.push(
    `<meta name="twitter:description" content="${escapeAttr(head.twitter.description)}">`,
  )
  if (head.twitter.image) {
    lines.push(`<meta name="twitter:image" content="${escapeAttr(head.twitter.image)}">`)
  }
  if (head.noindex) {
    lines.push('<meta name="robots" content="noindex,nofollow">')
  }
  return lines.join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;')
}

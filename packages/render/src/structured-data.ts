import type { BlockNode } from '@olps/domain'
import { buildBreadcrumbs, buildListData, type RenderMode } from './navigation.js'
import type { SiteCollection, SiteModel, SitePage } from './site-model.js'
import {
  absoluteUrlForGroup,
  absoluteUrlForItem,
  absoluteUrlForPage,
  collectionIndexUrl,
} from './urls.js'

export type StructuredDataTarget =
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

export type JsonLdObject = Record<string, unknown> & { '@type': string }

function siteOrigin(model: SiteModel): string {
  return model.settings.siteUrl.replace(/\/$/, '')
}

function toAbsolute(model: SiteModel, path: string): string {
  return `${siteOrigin(model)}${path}`
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

function assertRequired(
  typeName: string,
  value: Record<string, unknown>,
  keys: string[],
  context: string,
): void {
  for (const key of keys) {
    const field = value[key]
    if (field === undefined || field === null || field === '') {
      throw new Error(`结构化数据缺少必需属性：${typeName}.${key}（${context}）`)
    }
    if (Array.isArray(field) && field.length === 0) {
      throw new Error(`结构化数据缺少必需属性：${typeName}.${key}（${context}）`)
    }
  }
}

function buildOrganization(model: SiteModel): JsonLdObject {
  const organization: JsonLdObject = {
    '@type': 'Organization',
    name: model.settings.company.name,
    url: siteOrigin(model),
    email: model.settings.company.email,
    telephone: model.settings.company.phone,
    address: model.settings.company.address,
  }
  if (model.settings.socialLinks.length > 0) {
    organization.sameAs = model.settings.socialLinks.map((link) => link.url)
  }
  assertRequired('Organization', organization, ['name', 'url'], 'site-settings')
  return organization
}

function buildWebSite(model: SiteModel, locale: string): JsonLdObject {
  const website: JsonLdObject = {
    '@type': 'WebSite',
    name: model.settings.siteName,
    url: toAbsolute(model, `/${locale}/`),
    potentialAction: {
      '@type': 'SearchAction',
      target: `${toAbsolute(model, `/${locale}/`)}?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }
  assertRequired('WebSite', website, ['name', 'url'], 'site-settings')
  return website
}

function buildLocalBusiness(model: SiteModel): JsonLdObject {
  const localBusiness: JsonLdObject = {
    '@type': 'LocalBusiness',
    name: model.settings.company.name,
    address: model.settings.company.address,
    telephone: model.settings.company.phone,
    email: model.settings.company.email,
  }
  assertRequired(
    'LocalBusiness',
    localBusiness,
    ['name', 'address', 'telephone'],
    'contact',
  )
  return localBusiness
}

function collectFaqItems(blocks: BlockNode[]): Array<{ question: string; answer: string }> {
  const items: Array<{ question: string; answer: string }> = []
  for (const block of blocks) {
    if (block.type === 'core/faq') {
      const list = block.props.items
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (
            typeof entry === 'object'
            && entry !== null
            && typeof (entry as { question?: unknown }).question === 'string'
            && typeof (entry as { answer?: unknown }).answer === 'string'
          ) {
            items.push({
              question: (entry as { question: string }).question,
              answer: (entry as { answer: string }).answer,
            })
          }
        }
      }
    }
    if (block.children.length > 0) {
      items.push(...collectFaqItems(block.children))
    }
  }
  return items
}

function buildFaqPage(blocks: BlockNode[], context: string): JsonLdObject | null {
  const items = collectFaqItems(blocks)
  if (items.length === 0) {
    return null
  }
  const faq: JsonLdObject = {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
  assertRequired('FAQPage', faq, ['mainEntity'], context)
  return faq
}

function buildBreadcrumbList(
  model: SiteModel,
  target: StructuredDataTarget,
): JsonLdObject {
  const crumbs = buildBreadcrumbs(model, target)
  const breadcrumb: JsonLdObject = {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.title,
      item: toAbsolute(model, crumb.url),
    })),
  }
  assertRequired('BreadcrumbList', breadcrumb, ['itemListElement'], target.kind)
  return breadcrumb
}

function buildItemList(
  model: SiteModel,
  target: Extract<StructuredDataTarget, { kind: 'collection' | 'group' }>,
): JsonLdObject {
  const list = target.kind === 'collection'
    ? buildListData(model, {
        kind: 'collection',
        collectionId: target.collectionId,
        locale: target.locale,
        mode: target.mode,
        pageNumber: 1,
        pageSize: 1000,
        sort: 'manual',
      })
    : buildListData(model, {
        kind: 'group',
        collectionId: target.collectionId,
        groupId: target.groupId,
        locale: target.locale,
        mode: target.mode,
        pageNumber: 1,
        pageSize: 1000,
        sort: 'manual',
      })

  const itemList: JsonLdObject = {
    '@type': 'ItemList',
    itemListElement: list.items.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.title,
      url: toAbsolute(model, entry.url),
    })),
  }
  assertRequired('ItemList', itemList, ['itemListElement'], target.kind)
  return itemList
}

function buildProductLike(
  model: SiteModel,
  collection: SiteCollection,
  itemId: string,
  locale: string,
): JsonLdObject {
  const item = collection.items.find((entry) => entry.meta.itemId === itemId)
  if (!item) {
    throw new Error(`条目不存在：${itemId}`)
  }
  const localeFile = item.locales[locale]
  const url = absoluteUrlForItem(collection, item, locale)
  if (!localeFile || !url) {
    throw new Error(`条目缺少语言文件或地址：${itemId} ${locale}`)
  }
  const typeName = collection.definition.structuredData
  if (!typeName) {
    throw new Error(`内容类型未配置 structuredData：${collection.definition.collectionId}`)
  }
  const data: JsonLdObject = {
    '@type': typeName,
    name: localeFile.title,
    description: localeFile.summary || localeFile.seo.description,
    url: toAbsolute(model, url),
  }
  assertRequired(typeName, data, ['name', 'url'], item.directoryPath)
  return data
}

export function buildStructuredData(
  model: SiteModel,
  target: StructuredDataTarget,
): JsonLdObject[] {
  const result: JsonLdObject[] = [
    buildOrganization(model),
    buildWebSite(model, target.locale),
  ]

  if (target.kind === 'page') {
    const page = requirePage(model, target.pageId)
    const localeFile = page.locales[target.locale]
    if (!localeFile) {
      throw new Error(`页面缺少语言文件：${target.pageId} ${target.locale}`)
    }
    if (page.meta.role === 'contact') {
      result.push(buildLocalBusiness(model))
    }
    const faq = buildFaqPage(localeFile.blocks, page.directoryPath)
    if (faq) {
      result.push(faq)
    }
    if (page.meta.role !== 'home' && page.meta.role !== 'not-found') {
      result.push(buildBreadcrumbList(model, target))
    }
    return result
  }

  if (target.kind === 'collection' || target.kind === 'group') {
    result.push(buildItemList(model, target))
    result.push(buildBreadcrumbList(model, target))
    const collection = requireCollection(model, target.collectionId)
    const blocks =
      target.kind === 'collection'
        ? collection.indexLocales[target.locale]?.blocks ?? []
        : collection.groups.find((group) => group.meta.groupId === target.groupId)
            ?.locales[target.locale]?.blocks ?? []
    const faq = buildFaqPage(blocks, target.kind)
    if (faq) {
      result.push(faq)
    }
    return result
  }

  const collection = requireCollection(model, target.collectionId)
  if (collection.definition.structuredData) {
    result.push(
      buildProductLike(model, collection, target.itemId, target.locale),
    )
  }
  result.push(buildBreadcrumbList(model, target))
  const item = collection.items.find((entry) => entry.meta.itemId === target.itemId)
  const blocks = item?.locales[target.locale]?.blocks ?? []
  const faq = buildFaqPage(blocks, item?.directoryPath ?? 'item')
  if (faq) {
    result.push(faq)
  }
  return result
}

export function renderStructuredDataHtml(entries: JsonLdObject[]): string {
  return entries
    .map((entry) => {
      const payload = {
        '@context': 'https://schema.org',
        ...entry,
      }
      return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`
    })
    .join('\n')
}

export function absolutePathForTarget(
  model: SiteModel,
  target: StructuredDataTarget,
): string {
  if (target.kind === 'page') {
    const page = requirePage(model, target.pageId)
    const url = absoluteUrlForPage(page, target.locale)
    if (!url) {
      throw new Error(`页面地址不可用：${target.pageId}`)
    }
    return url
  }
  const collection = requireCollection(model, target.collectionId)
  if (target.kind === 'collection') {
    return collectionIndexUrl(target.locale, collection.definition.prefix)
  }
  if (target.kind === 'group') {
    const group = collection.groups.find((entry) => entry.meta.groupId === target.groupId)
    if (!group) {
      throw new Error(`分组不存在：${target.groupId}`)
    }
    const url = absoluteUrlForGroup(collection, group, target.locale)
    if (!url) {
      throw new Error(`分组地址不可用：${target.groupId}`)
    }
    return url
  }
  const item = collection.items.find((entry) => entry.meta.itemId === target.itemId)
  if (!item) {
    throw new Error(`条目不存在：${target.itemId}`)
  }
  const url = absoluteUrlForItem(collection, item, target.locale)
  if (!url) {
    throw new Error(`条目地址不可用：${target.itemId}`)
  }
  return url
}

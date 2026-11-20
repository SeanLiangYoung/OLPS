import type { BlockNode } from '@olps/domain'
import { loadBlockRegistry } from './blocks/registry.js'
import { renderBlockTree } from './blocks/render-tree.js'
import { createFilterRuntime, registerFilters } from './filters.js'
import { buildLocaleStringMap } from './i18n.js'
import { createLiquidEngine, loadLiquidTemplateFiles } from './liquid.js'
import {
  resolveCollectionListItems,
  type RenderMode,
} from './navigation.js'
import { buildSeoHead, renderSeoHeadHtml } from './seo-head.js'
import type { SiteModel } from './site-model.js'
import type { SourceReader } from './source-reader.js'
import {
  buildStructuredData,
  renderStructuredDataHtml,
} from './structured-data.js'
import {
  buildTemplateContext,
  resolveLinkValue,
  type TemplateContextTarget,
} from './template-context.js'
import {
  absoluteUrlForGroup,
  absoluteUrlForItem,
  absoluteUrlForPage,
  collectionIndexUrl,
} from './urls.js'

export type RenderTargetRef = TemplateContextTarget

export type RenderDocumentOptions = {
  mode: RenderMode
  reader: SourceReader
  pageNumber?: number
  assetHashes?: Record<string, string>
}

export type ResolveTemplatePathInput = {
  themeId: string
  kind: 'page' | 'collection' | 'group' | 'item'
  role: string | null
  template: string
  collectionId: string | null
}

const REQUIRED_TEMPLATES = [
  'page.liquid',
  'collection.liquid',
  'group.liquid',
  'item.liquid',
] as const

async function templateExists(
  reader: SourceReader,
  relativePath: string,
): Promise<boolean> {
  try {
    await reader.readText(relativePath)
    return true
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && (error as { code?: string }).code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}

export async function assertRequiredTemplates(
  reader: SourceReader,
  themeId: string,
): Promise<void> {
  const missing: string[] = []
  for (const fileName of REQUIRED_TEMPLATES) {
    const path = `themes/${themeId}/templates/${fileName}`
    if (!(await templateExists(reader, path))) {
      missing.push(path)
    }
  }
  if (missing.length > 0) {
    throw new Error(`缺少必需模板：${missing.join(', ')}`)
  }
}

export async function resolveTemplatePath(
  reader: SourceReader,
  input: ResolveTemplatePathInput,
): Promise<string> {
  await assertRequiredTemplates(reader, input.themeId)
  const base = `themes/${input.themeId}/templates`

  if (input.kind === 'page') {
    if (input.role) {
      const rolePath = `${base}/page-${input.role}.liquid`
      if (await templateExists(reader, rolePath)) {
        return rolePath
      }
    }
    if (input.template && input.template !== 'page') {
      const customPath = `${base}/page-${input.template}.liquid`
      if (await templateExists(reader, customPath)) {
        return customPath
      }
    }
    const pagePath = `${base}/page.liquid`
    if (!(await templateExists(reader, pagePath))) {
      throw new Error(`缺少必需模板：${pagePath}`)
    }
    return pagePath
  }

  if (input.collectionId) {
    const specific = `${base}/${input.kind}-${input.collectionId}.liquid`
    if (await templateExists(reader, specific)) {
      return specific
    }
  }

  const fallback = `${base}/${input.kind}.liquid`
  if (!(await templateExists(reader, fallback))) {
    throw new Error(`缺少必需模板：${fallback}`)
  }
  return fallback
}

function enabledPluginIds(model: SiteModel): string[] {
  return Object.entries(model.plugins.plugins)
    .filter(([, config]) => config.enabled)
    .map(([id]) => id)
}

function currentPath(
  model: SiteModel,
  target: RenderTargetRef,
  locale: string,
): string {
  if (target.kind === 'page') {
    const page = model.pages.find((entry) => entry.meta.pageId === target.pageId)
    if (!page) {
      throw new Error(`页面不存在：${target.pageId}`)
    }
    const url = absoluteUrlForPage(page, locale)
    if (!url) {
      throw new Error(`页面地址不可用：${target.pageId}`)
    }
    return url
  }
  const collection = model.collections.find(
    (entry) => entry.definition.collectionId === target.collectionId,
  )
  if (!collection) {
    throw new Error(`内容类型不存在：${target.collectionId}`)
  }
  if (target.kind === 'collection') {
    return collectionIndexUrl(locale, collection.definition.prefix)
  }
  if (target.kind === 'group') {
    const group = collection.groups.find((entry) => entry.meta.groupId === target.groupId)
    if (!group) {
      throw new Error(`分组不存在：${target.groupId}`)
    }
    const url = absoluteUrlForGroup(collection, group, locale)
    if (!url) {
      throw new Error(`分组地址不可用：${target.groupId}`)
    }
    return url
  }
  const item = collection.items.find((entry) => entry.meta.itemId === target.itemId)
  if (!item) {
    throw new Error(`条目不存在：${target.itemId}`)
  }
  const url = absoluteUrlForItem(collection, item, locale)
  if (!url) {
    throw new Error(`条目地址不可用：${target.itemId}`)
  }
  return url
}

function resolveBlocks(
  model: SiteModel,
  target: RenderTargetRef,
  locale: string,
): { blocks: BlockNode[]; objectPath: string } {
  if (target.kind === 'page') {
    const page = model.pages.find((entry) => entry.meta.pageId === target.pageId)
    if (!page) {
      throw new Error(`页面不存在：${target.pageId}`)
    }
    const localeFile = page.locales[locale]
    if (!localeFile) {
      throw new Error(`页面缺少语言文件：${target.pageId} ${locale}`)
    }
    return {
      blocks: localeFile.blocks,
      objectPath: `${page.directoryPath}/${locale}.json`,
    }
  }

  const collection = model.collections.find(
    (entry) => entry.definition.collectionId === target.collectionId,
  )
  if (!collection) {
    throw new Error(`内容类型不存在：${target.collectionId}`)
  }

  if (target.kind === 'collection') {
    const localeFile = collection.indexLocales[locale]
    if (!localeFile) {
      throw new Error(`内容类型缺少语言文件：${target.collectionId}`)
    }
    return {
      blocks: localeFile.blocks,
      objectPath: `source/collections/${target.collectionId}/index/${locale}.json`,
    }
  }

  if (target.kind === 'group') {
    const group = collection.groups.find((entry) => entry.meta.groupId === target.groupId)
    if (!group) {
      throw new Error(`分组不存在：${target.groupId}`)
    }
    const localeFile = group.locales[locale]
    if (!localeFile) {
      throw new Error(`分组缺少语言文件：${target.groupId}`)
    }
    return {
      blocks: localeFile.blocks,
      objectPath: `${group.directoryPath}/${locale}.json`,
    }
  }

  const item = collection.items.find((entry) => entry.meta.itemId === target.itemId)
  if (!item) {
    throw new Error(`条目不存在：${target.itemId}`)
  }
  const localeFile = item.locales[locale]
  if (!localeFile) {
    throw new Error(`条目缺少语言文件：${target.itemId}`)
  }
  return {
    blocks: localeFile.blocks,
    objectPath: `${item.directoryPath}/${locale}.json`,
  }
}

function listCurrent(
  target: RenderTargetRef,
  pageNumber: number,
): Parameters<typeof resolveCollectionListItems>[1]['current'] {
  if (target.kind === 'collection') {
    return { kind: 'collection', collectionId: target.collectionId, pageNumber }
  }
  if (target.kind === 'group') {
    return {
      kind: 'group',
      collectionId: target.collectionId,
      groupId: target.groupId,
      pageNumber,
    }
  }
  if (target.kind === 'page') {
    return { kind: 'page' }
  }
  return { kind: 'item' }
}

function findCollectionListProps(blocks: BlockNode[]): Record<string, unknown> | null {
  for (const block of blocks) {
    if (block.type === 'core/collection-list') {
      return block.props
    }
    const nested = findCollectionListProps(block.children)
    if (nested) {
      return nested
    }
  }
  return null
}

function injectHead(html: string, headHtml: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n${headHtml}\n`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(
      /<html([^>]*)>/i,
      `<html$1><head>\n${headHtml}\n</head>`,
    )
  }
  return `<!DOCTYPE html><html><head>\n${headHtml}\n</head><body>${html}</body></html>`
}

export async function renderTarget(
  model: SiteModel,
  target: RenderTargetRef,
  locale: string,
  options: RenderDocumentOptions,
): Promise<string> {
  const themeId = model.appearance.themeId
  const pluginIds = enabledPluginIds(model)
  const reader = options.reader
  const fromUrl = currentPath(model, target, locale)
  const { blocks, objectPath } = resolveBlocks(model, target, locale)

  const templateMeta = (() => {
    if (target.kind === 'page') {
      const page = model.pages.find((entry) => entry.meta.pageId === target.pageId)
      if (!page) {
        throw new Error(`页面不存在：${target.pageId}`)
      }
      return {
        kind: 'page' as const,
        role: page.meta.role,
        template: page.meta.template,
        collectionId: null,
      }
    }
    return {
      kind: target.kind,
      role: null,
      template: target.kind,
      collectionId: target.collectionId,
    }
  })()

  const templatePath = await resolveTemplatePath(reader, {
    themeId,
    kind: templateMeta.kind,
    role: templateMeta.role,
    template: templateMeta.template,
    collectionId: templateMeta.collectionId,
  })

  const liquidRoots = {
    themeRoot: `themes/${themeId}`,
    pluginRoots: pluginIds.map((id) => `plugins/${id}`),
  }
  const files = await loadLiquidTemplateFiles(reader, liquidRoots)
  const engine = createLiquidEngine({ files, roots: liquidRoots })

  const strings = await buildLocaleStringMap(reader, {
    locale,
    themeId,
    enabledPluginIds: pluginIds,
    siteStrings: model.i18n[locale]?.strings ?? {},
  })

  const mediaById = Object.fromEntries(
    model.media.map((media) => [
      media.mediaId,
      {
        path: media.path,
        width: media.width,
        height: media.height,
      },
    ]),
  )

  const filterRuntime = createFilterRuntime({
    locale,
    themeId,
    assetHashes: options.assetHashes,
    mediaById,
    strings,
    resolveLink: (value) =>
      resolveLinkValue(model, value, {
        locale,
        fromUrl,
        mode: options.mode,
      }),
  })
  registerFilters(engine, filterRuntime)

  const registry = await loadBlockRegistry(reader, {
    themeId,
    enabledPluginIds: pluginIds,
  })

  const listProps = findCollectionListProps(blocks)
  const listItems = listProps
    ? resolveCollectionListItems(model, {
        locale,
        mode: options.mode,
        props: listProps,
        current: listCurrent(target, options.pageNumber ?? 1),
      })
    : []

  const contentHtml = await renderBlockTree(blocks, {
    objectPath,
    engine,
    registry,
    filterRuntime,
    listItems,
    canvas: options.mode === 'canvas',
  })

  const context = await buildTemplateContext(model, {
    ...target,
    locale,
    mode: options.mode,
    reader,
    contentHtml,
    pageNumber: options.pageNumber,
  })

  const templateSource = await reader.readText(templatePath)
  const bodyHtml = await engine.parseAndRender(templateSource, context)

  const seo = buildSeoHead(model, {
    ...target,
    locale,
    mode: options.mode,
  })
  const structured = buildStructuredData(model, {
    ...target,
    locale,
    mode: options.mode,
  })

  const headHtml = [
    renderSeoHeadHtml(seo),
    renderStructuredDataHtml(structured),
  ].join('\n')

  return injectHead(bodyHtml, headHtml)
}

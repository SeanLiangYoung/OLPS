import { requiredPages, type BlockNode, type ContentRef } from '@olps/domain'
import {
  assertNoUrlConflicts,
  loadBlockRegistry,
  resolveContentRef,
  type SiteModel,
  type SourceReader,
} from '@olps/render'
import type { LoadedSiteWorkspace } from './types.js'

function enabledPluginIds(model: SiteModel): string[] {
  return Object.entries(model.plugins.plugins)
    .filter(([, config]) => config.enabled)
    .map(([id]) => id)
}

function walkBlocks(blocks: BlockNode[], visit: (block: BlockNode) => void): void {
  for (const block of blocks) {
    visit(block)
    walkBlocks(block.children, visit)
  }
}

function collectBlocks(model: SiteModel, mode: 'publish' | 'preview'): Array<{ path: string; blocks: BlockNode[] }> {
  const entries: Array<{ path: string; blocks: BlockNode[] }> = []
  for (const page of model.pages) {
    if (mode === 'publish' && page.meta.status !== 'published') continue
    for (const [locale, localeFile] of Object.entries(page.locales)) {
      entries.push({
        path: `${page.directoryPath}/${locale}.json`,
        blocks: localeFile.blocks,
      })
    }
  }
  for (const collection of model.collections) {
    if (mode === 'publish' && collection.definition.status !== 'published') continue
    for (const [locale, localeFile] of Object.entries(collection.indexLocales)) {
      entries.push({
        path: `source/collections/${collection.definition.collectionId}/index/${locale}.json`,
        blocks: localeFile.blocks,
      })
    }
    for (const group of collection.groups) {
      if (mode === 'publish' && group.meta.status !== 'published') continue
      for (const [locale, localeFile] of Object.entries(group.locales)) {
        entries.push({
          path: `${group.directoryPath}/${locale}.json`,
          blocks: localeFile.blocks,
        })
      }
    }
    for (const item of collection.items) {
      if (mode === 'publish' && item.meta.status !== 'published') continue
      for (const [locale, localeFile] of Object.entries(item.locales)) {
        entries.push({
          path: `${item.directoryPath}/${locale}.json`,
          blocks: localeFile.blocks,
        })
      }
    }
  }
  return entries
}

function assertRequiredPagesHaveBlocks(model: SiteModel): void {
  const locales = model.settings.locales.map((locale) => locale.code)
  for (const locale of locales) {
    for (const definition of requiredPages) {
      const page = model.pages.find((candidate) => candidate.meta.role === definition.role)
      if (!page) {
        throw new Error(`缺少必备页面：role=${definition.role}`)
      }
      const localeFile = page.locales[locale]
      if (!localeFile) {
        throw new Error(`缺少必备页面语言文件：role=${definition.role}, locale=${locale}`)
      }
      if (localeFile.blocks.length === 0) {
        throw new Error(`必备页面缺少区块：role=${definition.role}, locale=${locale}`)
      }
    }
  }
}

function assertRedirectsDoNotConflict(model: SiteModel): void {
  const occupied = new Set<string>()
  for (const locale of model.settings.locales.map((item) => item.code)) {
    for (const page of model.pages) {
      if (page.meta.role === 'not-found') {
        occupied.add(`/${locale}/404.html`)
        continue
      }
      const localeFile = page.locales[locale]
      if (!localeFile) {
        continue
      }
      occupied.add(localeFile.slug === '' ? `/${locale}/` : `/${locale}/${localeFile.slug}/`)
    }
    for (const collection of model.collections) {
      occupied.add(`/${locale}/${collection.definition.prefix}/`)
    }
  }

  for (const redirect of model.redirects.redirects) {
    if (occupied.has(redirect.from)) {
      throw new Error(`旧地址与现有地址冲突：${redirect.from}`)
    }
  }
}

async function assertBlocksDefined(
  reader: SourceReader,
  model: SiteModel,
  mode: 'publish' | 'preview',
): Promise<void> {
  const registry = await loadBlockRegistry(reader, {
    themeId: model.appearance.themeId,
    enabledPluginIds: enabledPluginIds(model),
  })
  for (const entry of collectBlocks(model, mode)) {
    walkBlocks(entry.blocks, (block) => {
      if (!registry.has(block.type)) {
        throw new Error(`区块缺少定义：${block.type} @ ${entry.path}`)
      }
    })
  }
}

function inspectValueForRefs(
  value: unknown,
  visit: (ref: ContentRef) => void,
): void {
  if (value === null || value === undefined) {
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      inspectValueForRefs(item, visit)
    }
    return
  }
  if (typeof value !== 'object') {
    return
  }
  const record = value as Record<string, unknown>
  if (
    record.kind === 'internal'
    && record.target
    && typeof record.target === 'object'
    && record.target !== null
  ) {
    const target = record.target as ContentRef
    if (typeof target.ref === 'string' && typeof target.id === 'string') {
      visit(target)
    }
    return
  }
  if (typeof record.ref === 'string' && typeof record.id === 'string' && !('mediaId' in record)) {
    visit(record as ContentRef)
    return
  }
  for (const nested of Object.values(record)) {
    inspectValueForRefs(nested, visit)
  }
}

function assertInternalRefsExist(model: SiteModel, mode: 'publish' | 'preview'): void {
  const locale = model.settings.defaultLocale
  const fromUrl = `/${locale}/`
  for (const entry of collectBlocks(model, mode)) {
    walkBlocks(entry.blocks, (block) => {
      inspectValueForRefs(block.props, (ref) => {
        resolveContentRef(model, ref, {
          locale,
          fromUrl,
          mode,
        })
      })
    })
  }

  for (const items of Object.values(model.appearance.menus)) {
    const walkMenu = (nodes: typeof items): void => {
      for (const item of nodes) {
        inspectValueForRefs(item.link, (ref) => {
          resolveContentRef(model, ref, {
            locale,
            fromUrl,
            mode,
          })
        })
        walkMenu(item.children)
      }
    }
    walkMenu(items)
  }
}

async function directoryExists(reader: SourceReader, relativePath: string): Promise<boolean> {
  try {
    await reader.list(relativePath)
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

async function assertLocaleLanguageFiles(
  reader: SourceReader,
  model: SiteModel,
): Promise<void> {
  const themeId = model.appearance.themeId
  const pluginIds = enabledPluginIds(model)
  for (const locale of model.settings.locales.map((item) => item.code)) {
    try {
      await reader.readText(`themes/${themeId}/languages/${locale}.json`)
    } catch {
      throw new Error(`缺少主题固定文字：themes/${themeId}/languages/${locale}.json`)
    }
    for (const pluginId of pluginIds) {
      const languagesDir = `plugins/${pluginId}/languages`
      if (!(await directoryExists(reader, languagesDir))) {
        continue
      }
      try {
        await reader.readText(`${languagesDir}/${locale}.json`)
      } catch {
        throw new Error(`缺少插件固定文字：${languagesDir}/${locale}.json`)
      }
    }
  }
}

export async function runBuildChecks(loaded: LoadedSiteWorkspace, mode: 'publish' | 'preview' = 'publish'): Promise<void> {
  const { model, reader } = loaded
  assertRequiredPagesHaveBlocks(model)
  assertNoUrlConflicts(model)
  assertRedirectsDoNotConflict(model)
  await assertBlocksDefined(reader, model, mode)
  assertInternalRefsExist(model, mode)
  await assertLocaleLanguageFiles(reader, model)
}

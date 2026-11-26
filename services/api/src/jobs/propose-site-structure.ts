import { requiredPages } from '@olps/domain'
import type { SiteModel } from '@olps/render'
import { ContentError } from '../content-sandbox.js'
import type { GenerationNodeRequest } from './schema.js'

export type ExistingPageSummary = {
  pageId: string
  role: string | null
  title: string
}

export type ExistingCollectionSummary = {
  collectionId: string
  name: string
  prefix: string
  title: string
  levels: Array<{ levelId: string; name: string }>
}

export const proposeSiteStructureRules = `必须输出完整企业网站结构树，禁止只输出单个页面或过少节点。
1. 必须包含八个必备页面（page），meta.role 分别为 home、about、contact、privacy、terms、cookies、thank-you、not-found；若 existingPages 已有对应页面，nodeId 必须使用其 pageId。
2. 必须基于 existingCollections 规划产品、新闻、解决方案：每个内容类型输出一个 collection 节点，nodeId 使用已有 collectionId。
3. 产品（prefix=products）：在产品 collection 的 children 中规划产品系列(group)、必要时产品分类(group)，以及若干产品详情(item)；group/item 的 collectionId 必须等于产品 collectionId。
4. 新闻（prefix=news）：在新闻 collection 的 children 中规划若干新闻详情(item)。
5. 解决方案（prefix=solutions）：在解决方案 collection 的 children 中规划数个解决方案详情(item)。
6. 用 children 表达层级；每个节点填写具体 title 与基于知识库的 requirements；事实以知识库为准，禁止编造资料之外的产品或新闻。
7. 新建 group/item 的 nodeId 使用新的 UUID；全部节点字段符合输出格式。`

export function summarizeExistingPages(model: SiteModel, locale: string): ExistingPageSummary[] {
  return model.pages.map((page) => {
    const localized = page.locales[locale] ?? Object.values(page.locales)[0]
    return {
      pageId: page.meta.pageId,
      role: page.meta.role ?? null,
      title: localized?.title ?? '',
    }
  })
}

export function summarizeExistingCollections(
  model: SiteModel,
  locale: string,
): ExistingCollectionSummary[] {
  return model.collections.map((collection) => {
    const localized = collection.indexLocales[locale]
    const labels = collection.definition.labels as Record<string, string>
    return {
      collectionId: collection.definition.collectionId,
      name: collection.definition.name,
      prefix: collection.definition.prefix,
      title: localized?.title ?? labels[locale] ?? collection.definition.name,
      levels: collection.definition.levels.map((level) => ({
        levelId: level.levelId,
        name: level.name,
      })),
    }
  })
}

function walk(nodes: GenerationNodeRequest[]): GenerationNodeRequest[] {
  return nodes.flatMap((node) => [node, ...walk(node.children ?? [])])
}

function findPageByRole(
  nodes: GenerationNodeRequest[],
  role: string,
): GenerationNodeRequest | undefined {
  return walk(nodes).find(
    (node) => node.ref === 'page' && String(node.meta?.role ?? '') === role,
  )
}

function findCollectionNode(
  nodes: GenerationNodeRequest[],
  collectionId: string,
): GenerationNodeRequest | undefined {
  return walk(nodes).find(
    (node) => node.ref === 'collection' && node.nodeId === collectionId,
  )
}

/** 补齐必备页面与已有内容类型根节点，保证规划结果至少覆盖整站骨架。 */
export function ensureProposedSiteStructure(
  nodes: GenerationNodeRequest[],
  pages: ExistingPageSummary[],
  collections: ExistingCollectionSummary[],
): GenerationNodeRequest[] {
  const next = nodes.map((node) => structuredClone(node))

  for (const definition of requiredPages) {
    if (findPageByRole(next, definition.role)) continue
    const existing = pages.find((page) => page.role === definition.role)
    if (!existing) {
      throw new ContentError('VALIDATION_FAILED', {
        field: 'requiredPages',
        role: definition.role,
      })
    }
    next.unshift({
      nodeId: existing.pageId,
      ref: 'page',
      title: existing.title || definition.name.en,
      requirements: `根据公司信息与知识库完善「${definition.name['zh-CN']}」页面。`,
      meta: { role: definition.role },
      children: [],
    })
  }

  for (const collection of collections) {
    if (findCollectionNode(next, collection.collectionId)) continue
    next.push({
      nodeId: collection.collectionId,
      ref: 'collection',
      title: collection.title,
      requirements: `根据知识库完善「${collection.name}」列表页。`,
      children: [],
    })
  }

  for (const definition of requiredPages) {
    if (!findPageByRole(next, definition.role)) {
      throw new ContentError('VALIDATION_FAILED', {
        field: 'requiredPages',
        role: definition.role,
      })
    }
  }

  return next
}

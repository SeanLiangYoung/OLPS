import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { requiredPages } from '@olps/domain'
import {
  ensureProposedSiteStructure,
  type ExistingCollectionSummary,
  type ExistingPageSummary,
} from './propose-site-structure.js'
import type { GenerationNodeRequest } from './schema.js'

const pages: ExistingPageSummary[] = requiredPages.map((definition) => ({
  pageId: randomUUID(),
  role: definition.role,
  title: definition.name.en,
}))

const collections: ExistingCollectionSummary[] = [
  {
    collectionId: randomUUID(),
    name: '产品',
    prefix: 'products',
    title: 'Products',
    levels: [
      { levelId: randomUUID(), name: '产品系列' },
      { levelId: randomUUID(), name: '产品分类' },
    ],
  },
  {
    collectionId: randomUUID(),
    name: '新闻',
    prefix: 'news',
    title: 'News',
    levels: [],
  },
  {
    collectionId: randomUUID(),
    name: '解决方案',
    prefix: 'solutions',
    title: 'Solutions',
    levels: [],
  },
]

function flatten(nodes: GenerationNodeRequest[]): GenerationNodeRequest[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])])
}

describe('ensureProposedSiteStructure', () => {
  it('模型只返回单个页面时补齐必备页面与内容类型根节点', () => {
    const sparse: GenerationNodeRequest[] = [
      {
        nodeId: randomUUID(),
        ref: 'page',
        title: 'WEICHAI 400KW',
        requirements: '',
        children: [],
      },
    ]

    const ensured = ensureProposedSiteStructure(sparse, pages, collections)
    const all = flatten(ensured)

    for (const definition of requiredPages) {
      expect(
        all.some((node) => node.ref === 'page' && node.meta?.role === definition.role),
      ).toBe(true)
    }
    for (const collection of collections) {
      expect(all.some((node) => node.ref === 'collection' && node.nodeId === collection.collectionId)).toBe(
        true,
      )
    }
    expect(all.some((node) => node.title === 'WEICHAI 400KW')).toBe(true)
  })

  it('已有完整骨架时保持原节点', () => {
    const complete: GenerationNodeRequest[] = [
      ...pages.map((page) => ({
        nodeId: page.pageId,
        ref: 'page' as const,
        title: page.title,
        requirements: '已有要求',
        meta: { role: page.role },
        children: [],
      })),
      ...collections.map((collection) => ({
        nodeId: collection.collectionId,
        ref: 'collection' as const,
        title: collection.title,
        requirements: '列表要求',
        children: [
          {
            nodeId: randomUUID(),
            ref: 'item' as const,
            collectionId: collection.collectionId,
            title: '示例条目',
            requirements: '条目要求',
            children: [],
          },
        ],
      })),
    ]

    const ensured = ensureProposedSiteStructure(complete, pages, collections)
    expect(ensured).toHaveLength(complete.length)
    expect(flatten(ensured).filter((node) => node.ref === 'item')).toHaveLength(3)
  })
})

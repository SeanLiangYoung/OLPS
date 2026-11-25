import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeAssetMeta, type AssetMetaRecord } from './asset-meta.js'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'

const token = 'knowledge-test-token'

async function authFetch(baseUrl: string, pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

async function ensureProject(baseUrl: string, siteId: string): Promise<void> {
  const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
  expect(res.status).toBe(200)
}

type SearchHit = {
  path: string
  snippet: string
  assetId?: string
  role?: string
}

type SearchResponse = {
  hits: SearchHit[]
}

describe('W4-T1 关键词检索 API', () => {
  it('已知标题/正文关键词命中至少 1 条', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('search-keyword')
    const siteId = 'search-keyword'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const projectDir = path.join(knowledgeRoot, siteId)
      await fs.writeFile(
        path.join(projectDir, 'wiki', 'product-overview.md'),
        '# 星云清洗机产品手册\n\n星云清洗机支持高温除菌与静音模式。\n',
        'utf8',
      )
      await fs.writeFile(
        path.join(projectDir, 'raw', 'sources', 'notes.txt'),
        '杂记：仓库库存与物流无关。\n',
        'utf8',
      )

      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/search`, {
        method: 'POST',
        body: JSON.stringify({ query: '星云清洗机' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as SearchResponse
      expect(body.hits.length).toBeGreaterThanOrEqual(1)
      expect(body.hits.some((hit) => hit.path === 'wiki/product-overview.md')).toBe(true)
      const wikiHit = body.hits.find((hit) => hit.path === 'wiki/product-overview.md')
      expect(wikiHit?.snippet).toContain('星云清洗机')
    } finally {
      close()
    }
  })

  it('按 role 过滤只返回该类资产命中', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('search-role')
    const siteId = 'search-role'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const projectDir = path.join(knowledgeRoot, siteId)
      const importId = '00000000-0000-4000-8000-000000000010'
      const base: Omit<AssetMetaRecord, 'assetId' | 'sourcePath' | 'role' | 'caption'> = {
        kind: 'image',
        mime: 'image/jpeg',
        sizeBytes: 100,
        width: 10,
        height: 10,
        importId,
        fingerprint: 'c'.repeat(64),
      }
      await writeAssetMeta(projectDir, {
        ...base,
        assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sourcePath: 'raw/sources/media/hero-product.jpg',
        role: 'product_image',
        roleConfidence: 0.9,
        roleReason: '产品主图',
        caption: '星云清洗机主视觉产品图',
      })
      await writeAssetMeta(projectDir, {
        ...base,
        assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        sourcePath: 'raw/sources/media/brand-logo.jpg',
        role: 'logo',
        roleConfidence: 0.91,
        roleReason: '品牌标识',
        caption: '星云清洗机品牌 logo',
      })
      await fs.writeFile(
        path.join(projectDir, 'wiki', 'misc.md'),
        '# 杂页\n\n正文提到星云清洗机但不属于素材。\n',
        'utf8',
      )

      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/search`, {
        method: 'POST',
        body: JSON.stringify({ query: '星云清洗机', role: 'product_image' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as SearchResponse
      expect(body.hits.length).toBeGreaterThanOrEqual(1)
      expect(body.hits.every((hit) => hit.role === 'product_image')).toBe(true)
      expect(body.hits.every((hit) => hit.assetId === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(true)
      expect(body.hits.some((hit) => hit.path === 'wiki/misc.md')).toBe(false)
    } finally {
      close()
    }
  })

  it.each([
    [{}, 'missing_query'],
    [{ query: '' }, 'empty_string'],
    [{ query: '   ' }, 'whitespace_only'],
  ])('空查询 %# 返回 400 与明确 error code', async (payload, _label) => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('search-empty-query')
    const siteId = 'search-empty'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/search`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('search_query_required')
    } finally {
      close()
    }
  })
})

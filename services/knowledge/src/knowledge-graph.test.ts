import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'
import { writeAssetMeta } from './asset-meta.js'

const token = 'knowledge-graph-token'

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

function edgeKeySet(edges: Array<{ source: string; target: string }>): Set<string> {
  return new Set(edges.map((edge) => `${edge.source}->${edge.target}`))
}

function hasUndirectedEdge(edgeKeys: Set<string>, a: string, b: string): boolean {
  return edgeKeys.has(`${a}->${b}`) || edgeKeys.has(`${b}->${a}`)
}

describe('knowledge graph API', () => {
  it('未初始化项目返回 project_not_found', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('graph-missing')
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      const res = await authFetch(baseUrl, '/api/v1/projects/missing-site/graph')
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'project_not_found' })
    } finally {
      close()
    }
  })

  it('只根据 related / wikilink / 显式 assetIds 建边，未引用素材不进图', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('graph-ok')
    const siteId = 'graph-site'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      expect((await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })).status).toBe(200)
      const projectDir = path.join(knowledgeRoot, siteId)
      const sourceWikiDir = path.join(projectDir, 'wiki', 'sources', 'files')
      const productWikiDir = path.join(projectDir, 'wiki', 'sources', 'products', 'abc')
      await fs.mkdir(sourceWikiDir, { recursive: true })
      await fs.mkdir(productWikiDir, { recursive: true })
      await fs.writeFile(
        path.join(sourceWikiDir, 'product-spec.md'),
        [
          '---',
          'title: 产品规格索引',
          'kind: imported_source_index',
          'importId: "import-1"',
          'related: ["washer"]',
          '---',
          '',
          '产品规格摘要',
          '',
          '- [清洗机](../products/abc/washer.md)',
          '',
        ].join('\n'),
        'utf8',
      )
      await fs.writeFile(
        path.join(productWikiDir, 'washer.md'),
        [
          '---',
          'title: 清洗机',
          'kind: imported_product',
          'importId: "import-1"',
          'productKey: "washer"',
          'related: ["product-spec"]',
          'assetIds: ["asset-photo-1"]',
          '---',
          '',
          '清洗机说明',
          '',
        ].join('\n'),
        'utf8',
      )
      await fs.writeFile(
        path.join(projectDir, 'wiki', 'orphan-note.md'),
        ['---', 'title: 独立笔记', 'kind: manual', '---', '', '与 overview 无链接', ''].join('\n'),
        'utf8',
      )
      await fs.writeFile(path.join(projectDir, 'wiki', 'overview.md'), '# Overview\n\n站点总览\n', 'utf8')
      await writeAssetMeta(projectDir, {
        assetId: 'asset-photo-1',
        sourcePath: 'raw/sources/product/photo.png',
        kind: 'image',
        mime: 'image/png',
        sizeBytes: 12,
        importId: 'import-1',
        fingerprint: 'bbb',
        role: 'product_image',
      })
      await writeAssetMeta(projectDir, {
        assetId: 'asset-loose-1',
        sourcePath: 'raw/sources/other/loose.png',
        kind: 'image',
        mime: 'image/png',
        sizeBytes: 8,
        importId: 'import-1',
        fingerprint: 'ccc',
        role: 'product_image',
      })

      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/graph`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        nodes: Array<{ id: string; type: string; label: string }>
        edges: Array<{ source: string; target: string }>
      }
      const ids = new Set(body.nodes.map((node) => node.id))
      expect(ids.has('overview')).toBe(true)
      expect(ids.has('product-spec')).toBe(true)
      expect(ids.has('washer')).toBe(true)
      expect(ids.has('orphan-note')).toBe(true)
      expect(ids.has('asset:asset-photo-1')).toBe(true)
      expect(ids.has('asset:asset-loose-1')).toBe(false)
      expect(body.nodes.find((node) => node.id === 'product-spec')?.type).toBe('source')
      expect(body.nodes.find((node) => node.id === 'washer')?.type).toBe('entity')
      expect(body.nodes.find((node) => node.id === 'asset:asset-photo-1')?.type).toBe('asset')

      const edgeKeys = edgeKeySet(body.edges)
      expect(hasUndirectedEdge(edgeKeys, 'washer', 'asset:asset-photo-1')).toBe(true)
      expect(hasUndirectedEdge(edgeKeys, 'product-spec', 'washer')).toBe(true)
      expect(hasUndirectedEdge(edgeKeys, 'product-spec', 'asset:asset-photo-1')).toBe(false)
      expect(hasUndirectedEdge(edgeKeys, 'overview', 'orphan-note')).toBe(false)
      expect(hasUndirectedEdge(edgeKeys, 'overview', 'product-spec')).toBe(false)
      expect(hasUndirectedEdge(edgeKeys, 'overview', 'washer')).toBe(false)
      expect(body.edges).toHaveLength(2)
    } finally {
      close()
    }
  })
})

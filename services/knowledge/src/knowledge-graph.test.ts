import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'
import { writeAssetMeta } from './asset-meta.js'
import { writeFingerprintStore } from './project-fingerprints.js'

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

  it('根据 wiki 页、素材与同目录指纹生成节点与边', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('graph-ok')
    const siteId = 'graph-site'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      expect((await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })).status).toBe(200)
      const projectDir = path.join(knowledgeRoot, siteId)
      const sourceWikiDir = path.join(projectDir, 'wiki', 'sources', 'files')
      await fs.mkdir(sourceWikiDir, { recursive: true })
      await fs.writeFile(
        path.join(sourceWikiDir, 'product-spec.md'),
        ['---', 'title: 产品规格', 'kind: imported_source', '---', '', '产品规格摘要', '', '参见 [[overview]]', ''].join(
          '\n',
        ),
        'utf8',
      )
      await fs.writeFile(
        path.join(projectDir, 'wiki', 'overview.md'),
        '# Overview\n\n站点总览\n\n- [产品规格](sources/files/product-spec.md)\n',
        'utf8',
      )
      await writeFingerprintStore(projectDir, {
        'raw/sources/product/spec.txt': {
          sha256: 'aaa',
          kind: 'text',
          wikiPath: 'wiki/sources/files/product-spec.md',
          ingestedSha256: 'aaa',
        },
        'raw/sources/product/photo.png': {
          sha256: 'bbb',
          kind: 'image',
          assetId: 'asset-photo-1',
        },
      })
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

      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/graph`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        nodes: Array<{ id: string; type: string; label: string }>
        edges: Array<{ source: string; target: string }>
      }
      const ids = new Set(body.nodes.map((node) => node.id))
      expect(ids.has('overview')).toBe(true)
      expect(ids.has('product-spec')).toBe(true)
      expect(ids.has('asset:asset-photo-1')).toBe(true)
      expect(body.nodes.find((node) => node.id === 'product-spec')?.type).toBe('source')
      expect(body.nodes.find((node) => node.id === 'asset:asset-photo-1')?.type).toBe('asset')
      const edgeKeys = new Set(body.edges.map((edge) => `${edge.source}->${edge.target}`))
      const hasProductAssetEdge =
        edgeKeys.has('product-spec->asset:asset-photo-1') || edgeKeys.has('asset:asset-photo-1->product-spec')
      expect(hasProductAssetEdge).toBe(true)
      const hasOverviewProduct =
        edgeKeys.has('overview->product-spec') || edgeKeys.has('product-spec->overview')
      expect(hasOverviewProduct).toBe(true)
    } finally {
      close()
    }
  })
})

import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createPendingImportItems,
  listFailedImportItemPaths,
  readImportItems,
  summarizeImportItems,
  writeImportItems,
} from './import-items.js'
import { findIngestedCanonicalByHash, formatAliasWikiPageMarkdown } from './ingest-service.js'
import type { FingerprintStore } from './project-fingerprints.js'
import { makeIsolatedKnowledgeRoot } from './test-harness.js'
import { ensureKnowledgeProject } from './project-layout.js'
import { wikiPathForImportedSource } from './source-wiki-path.js'

describe('import items 与内容指纹去重', () => {
  it('items.json 读写与失败项筛选', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('import-items')
    const siteId = 'import-items'
    await ensureKnowledgeProject(knowledgeRoot, siteId)
    const projectDir = path.join(knowledgeRoot, siteId)
    const importId = '11111111-1111-4111-8111-111111111111'
    const file = createPendingImportItems(importId, [
      'raw/sources/a.txt',
      'raw/sources/b.txt',
      'raw/sources/c.txt',
    ])
    file.items[0]!.status = 'succeeded'
    file.items[1]!.status = 'failed'
    file.items[1]!.error = 'AI 超时'
    file.items[2]!.status = 'skipped_duplicate'
    await writeImportItems(projectDir, file)

    const loaded = await readImportItems(projectDir, importId)
    expect(loaded?.items).toHaveLength(3)
    const summary = summarizeImportItems(loaded!.items)
    expect(summary.itemSucceeded).toBe(1)
    expect(summary.itemFailed).toBe(1)
    expect(summary.itemSkippedDuplicate).toBe(1)
    expect(listFailedImportItemPaths(loaded!.items)).toEqual(['raw/sources/b.txt'])
    expect(listFailedImportItemPaths(loaded!.items, ['raw/sources/a.txt'])).toEqual([])
  })

  it('同内容哈希优先命中非 alias 摘要页', () => {
    const hash = 'a'.repeat(64)
    const store: FingerprintStore = {
      'raw/sources/first.txt': {
        sha256: hash,
        kind: 'text',
        wikiPath: 'wiki/sources/files/first.md',
        ingestedSha256: hash,
      },
      'raw/sources/alias.txt': {
        sha256: hash,
        kind: 'text',
        wikiPath: 'wiki/sources/files/alias.md',
        aliasOfWikiPath: 'wiki/sources/files/first.md',
        ingestedSha256: hash,
      },
    }
    const found = findIngestedCanonicalByHash(store, hash, 'raw/sources/new.txt')
    expect(found?.sourcePath).toBe('raw/sources/first.txt')
    expect(found?.wikiPath).toBe('wiki/sources/files/first.md')
  })

  it('为新路径生成独立 wikiPath', () => {
    const pathA = wikiPathForImportedSource('raw/sources/docs/a.txt')
    const pathB = wikiPathForImportedSource('raw/sources/docs/b-copy.txt')
    expect(pathA).not.toBe(pathB)
    expect(pathA.startsWith('wiki/sources/files/')).toBe(true)
  })

  it('别名摘要页直接嵌入 canonical 正文且不含跳转链接', () => {
    const markdown = formatAliasWikiPageMarkdown({
      sourcePath: 'raw/sources/产品1/产品详情资料.docx',
      fingerprint: 'f'.repeat(64),
      importId: 'imp-alias',
      canonicalWikiPath: 'wiki/sources/files/canonical.md',
      title: 'Cummins 1500kW',
      canonicalBody: '## 产品概述\n\n这是完整摘要正文。\n',
    })
    expect(markdown).toContain('内容指纹与已有摘要相同，未再次调用 AI 解析。')
    expect(markdown).toContain('## 产品概述')
    expect(markdown).toContain('这是完整摘要正文。')
    expect(markdown).not.toContain('请阅读完整摘要')
    expect(markdown).not.toMatch(/\]\([^)]+\.md\)/)
  })

  it('导入完成状态可携带 items', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('import-items-status')
    const siteId = 'import-items-status'
    const { startKnowledgeServer } = await import('./test-harness.js')
    const token = 'knowledge-test-token'
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
      enableIngest: false,
    })
    try {
      const init = await fetch(`${baseUrl}/api/v1/projects/${siteId}/project`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(init.status).toBe(200)

      const content = Buffer.from('hello duplicate content\n', 'utf8').toString('base64')
      const create = await fetch(`${baseUrl}/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceName: 'dup-pack',
          files: [
            { relativePath: 'one.txt', contentBase64: content },
            { relativePath: 'two.txt', contentBase64: content },
          ],
        }),
      })
      expect(create.status).toBe(202)
      const { importId } = (await create.json()) as { importId: string }

      type StatusBody = {
        status: string
        items?: Array<{ sourcePath: string; status: string; fingerprint: string | null }>
      }
      const deadline = Date.now() + 30_000
      let body: StatusBody | null = null
      while (Date.now() < deadline) {
        const res = await fetch(`${baseUrl}/api/v1/projects/${siteId}/imports/${importId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(res.status).toBe(200)
        body = (await res.json()) as StatusBody
        if (body.status === 'completed' || body.status === 'failed') {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(body).not.toBeNull()
      expect(body!.status).toBe('completed')
      expect(body!.items?.length).toBe(2)
      expect(body!.items?.every((item) => item.fingerprint && item.fingerprint.length === 64)).toBe(true)
      expect(new Set(body!.items?.map((item) => item.fingerprint)).size).toBe(1)

      const projectDir = path.join(knowledgeRoot, siteId)
      const itemsOnDisk = await readImportItems(projectDir, importId)
      expect(itemsOnDisk?.items).toHaveLength(2)
      await fs.access(path.join(projectDir, 'raw', 'sources', 'one.txt'))
      await fs.access(path.join(projectDir, 'raw', 'sources', 'two.txt'))

      const retryEmpty = await fetch(`${baseUrl}/api/v1/projects/${siteId}/imports/${importId}/retry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      expect(retryEmpty.status).toBe(400)
      const retryBody = (await retryEmpty.json()) as { error: string }
      expect(retryBody.error).toBe('import_retry_empty')
    } finally {
      close()
    }
  })
})

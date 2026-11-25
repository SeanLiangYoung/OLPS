import fs from 'node:fs/promises'
import path from 'node:path'
import { zipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadKnowledgeAiConfig } from './ai-config.js'
import { readAssetMeta, writeAssetMeta } from './asset-meta.js'
import { finalizeAssetRoleAssignment } from './asset-role.js'
import { rebuildAssetsCatalogMarkdown } from './assets-catalog.js'
import { finalizeReimportIngestDecision, type WikiSourceCandidate } from './ingest-reimport.js'
import { createKnowledgeHttpClient } from './mcp-server/http-client.js'
import { invokeKnowledgeTool } from './mcp-server/tool-handlers.js'
import { readFingerprintStore } from './project-fingerprints.js'
import { readExtractedText } from './source-processing.js'
import { wikiPathForImportedSource } from './source-wiki-path.js'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'
import { ensureW2T3Fixtures, W2T3_FIXTURE_DIR } from './w2t3-fixture-builder.js'

const token = 'knowledge-design-acceptance-token'
const hasAiKey = Boolean(loadKnowledgeAiConfig(process.env).apiKey.trim())

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

function toBase64(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64')
}

type ImportStatusBody = {
  status: string
  error: string | null
  stats: {
    fileCount?: number
    extracted?: number
    skipped?: number
    fingerprintSkips?: number
    assetsRegistered?: number
    sourceBytesWritten?: number
    ingestPagesUpdated?: number
    writtenPaths?: string[]
  }
}

async function waitForImportCompleted(
  baseUrl: string,
  siteId: string,
  importId: string,
  timeoutMs = 240_000,
): Promise<ImportStatusBody> {
  const deadline = Date.now() + timeoutMs
  let last: ImportStatusBody | null = null
  while (Date.now() < deadline) {
    const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports/${importId}`)
    expect(res.status).toBe(200)
    last = (await res.json()) as ImportStatusBody
    if (last.status === 'completed') {
      return last
    }
    if (last.status === 'failed') {
      throw new Error(`import failed: ${last.error ?? 'unknown'}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`import ${importId} timeout`)
}

function mcpText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n')
}

async function buildProductPackZipBase64(): Promise<string> {
  const docx = await fs.readFile(path.join(W2T3_FIXTURE_DIR, 'sample.docx'))
  const xlsx = await fs.readFile(path.join(W2T3_FIXTURE_DIR, 'sample.xlsx'))
  const jpgA = await fs.readFile(path.join(W2T3_FIXTURE_DIR, 'sample.jpg'))
  const jpgB = await fs.readFile(path.join(W2T3_FIXTURE_DIR, 'sample.jpeg'))
  const entries: Record<string, Uint8Array> = {
    'product1/spec.docx': new Uint8Array(docx),
    'product1/price.xlsx': new Uint8Array(xlsx),
    'product1/photos/front.jpg': new Uint8Array(jpgA),
    'product1/photos/side.jpeg': new Uint8Array(jpgB),
  }
  return toBase64(zipSync(entries))
}

describe('设计 §11 总验收（@olps/knowledge）', () => {
  beforeAll(async () => {
    await ensureW2T3Fixtures()
  })

  // §11.1
  it('§11.1 产品1 类 zip（docx+xlsx+多 jpg）：抽取文档并写入确定性产品图角色', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('s11-product-pack')
    const siteId = 's11-product-pack'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const create = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'product1.zip',
          zipBase64: await buildProductPackZipBase64(),
        }),
      })
      expect(create.status).toBe(202)
      const { importId } = (await create.json()) as { importId: string }
      const done = await waitForImportCompleted(baseUrl, siteId, importId, 60_000)
      expect(done.stats.extracted).toBeGreaterThanOrEqual(4)
      expect(done.stats.assetsRegistered).toBeGreaterThanOrEqual(2)

      const projectDir = path.join(knowledgeRoot, siteId)
      const docxExtracted = await readExtractedText(projectDir, 'raw/sources/product1/spec.docx')
      const xlsxExtracted = await readExtractedText(projectDir, 'raw/sources/product1/price.xlsx')
      expect(docxExtracted.text).toContain('docx-extracted-text')
      expect(xlsxExtracted.text.toLowerCase()).toContain('widget')

      const store = await readFingerprintStore(projectDir)
      const imagePaths = [
        'raw/sources/product1/photos/front.jpg',
        'raw/sources/product1/photos/side.jpeg',
      ]
      for (const sourcePath of imagePaths) {
        const assetId = store[sourcePath]?.assetId
        expect(assetId).toBeTruthy()
        const meta = await readAssetMeta(projectDir, assetId!)
        const assigned = finalizeAssetRoleAssignment({
          suggestedRole: 'product_image',
          confidence: 0.92,
          reason: '§11.1 确定性产品图角色 fixture',
        })
        expect(assigned.role).toBe('product_image')
        await writeAssetMeta(projectDir, {
          ...meta,
          role: assigned.role,
          roleConfidence: assigned.storedConfidence,
          roleReason: '§11.1 确定性产品图角色 fixture',
          roleAssignedFingerprint: meta.fingerprint,
        })
      }
      await rebuildAssetsCatalogMarkdown(projectDir)

      const assetsRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/assets?role=product_image`)
      expect(assetsRes.status).toBe(200)
      const assetsBody = (await assetsRes.json()) as { assets: Array<{ role: string; sourcePath: string }> }
      expect(assetsBody.assets.length).toBeGreaterThanOrEqual(2)
      expect(assetsBody.assets.every((item) => item.role === 'product_image')).toBe(true)

      const catalog = await fs.readFile(path.join(projectDir, 'wiki', 'assets-catalog.md'), 'utf8')
      expect(catalog).toContain('product_image')
    } finally {
      close()
    }
  })

  // §11.1 有密钥时额外跑真实 Ingest；无密钥跳过，不导致套件失败
  it.skipIf(!hasAiKey)('§11.1 有密钥：产品包真实 Ingest 写出 Wiki 来源页', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('s11-product-ingest')
    const siteId = 's11-product-ingest'
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
      enableIngest: true,
    })
    try {
      await ensureProject(baseUrl, siteId)
      const create = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'product1-ai.zip',
          zipBase64: await buildProductPackZipBase64(),
        }),
      })
      expect(create.status).toBe(202)
      const { importId } = (await create.json()) as { importId: string }
      await waitForImportCompleted(baseUrl, siteId, importId)
      const projectDir = path.join(knowledgeRoot, siteId)
      const filesRoot = path.join(projectDir, 'wiki', 'sources', 'files')
      const names = await fs.readdir(filesRoot)
      expect(names.filter((name) => name.endsWith('.md')).length).toBeGreaterThanOrEqual(2)
    } finally {
      close()
    }
  })

  // §11.2
  it('§11.2 文件夹多文件导入保持相对路径', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('s11-folder-paths')
    const siteId = 's11-folder-paths'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const create = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'folder-pack',
          files: [
            { relativePath: 'docs/intro.md', contentBase64: toBase64(Buffer.from('# intro\n', 'utf8')) },
            {
              relativePath: 'docs/nested/detail.txt',
              contentBase64: toBase64(Buffer.from('detail-body\n', 'utf8')),
            },
          ],
        }),
      })
      expect(create.status).toBe(202)
      const { importId } = (await create.json()) as { importId: string }
      const done = await waitForImportCompleted(baseUrl, siteId, importId, 30_000)
      expect(done.stats.writtenPaths).toEqual(
        expect.arrayContaining([
          'raw/sources/docs/intro.md',
          'raw/sources/docs/nested/detail.txt',
        ]),
      )
      const projectDir = path.join(knowledgeRoot, siteId)
      expect(await fs.readFile(path.join(projectDir, 'raw/sources/docs/intro.md'), 'utf8')).toContain('intro')
      expect(await fs.readFile(path.join(projectDir, 'raw/sources/docs/nested/detail.txt'), 'utf8')).toBe(
        'detail-body\n',
      )
    } finally {
      close()
    }
  })

  // §11.3 无密钥：指纹相同 skip + 强制 update 规则
  it('§11.3 二次导入相同指纹跳过；无关主题强制 update 被拒绝', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('s11-reimport-skip')
    const siteId = 's11-reimport-skip'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const docx = await fs.readFile(path.join(W2T3_FIXTURE_DIR, 'sample.docx'))
      const entry = { relativePath: 'product/spec.docx', contentBase64: toBase64(docx) }
      const firstCreate = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'spec-v1', files: [entry] }),
      })
      expect(firstCreate.status).toBe(202)
      const { importId: firstId } = (await firstCreate.json()) as { importId: string }
      const first = await waitForImportCompleted(baseUrl, siteId, firstId, 30_000)
      expect(first.stats.sourceBytesWritten).toBe(docx.length)

      const secondCreate = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'spec-v1-again', files: [entry] }),
      })
      expect(secondCreate.status).toBe(202)
      const { importId: secondId } = (await secondCreate.json()) as { importId: string }
      const second = await waitForImportCompleted(baseUrl, siteId, secondId, 30_000)
      expect(second.stats.sourceBytesWritten).toBe(0)
      expect(second.stats.fingerprintSkips).toBeGreaterThanOrEqual(1)
    } finally {
      close()
    }

    const sourcePath = 'raw/sources/theme/new-unrelated.docx'
    const canonicalWikiPath = wikiPathForImportedSource(sourcePath)
    const foreignWikiPath = 'wiki/sources/files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md'
    const candidates: WikiSourceCandidate[] = [
      {
        wikiPath: foreignWikiPath,
        title: '产品规格',
        sourcePath: 'raw/sources/product/spec.docx',
        snippet: '产品规格与参数',
        fingerprint: 'b'.repeat(64),
      },
    ]
    const plan = finalizeReimportIngestDecision({
      sourcePath,
      canonicalWikiPath,
      ai: {
        decision: 'update',
        targetWikiPath: foreignWikiPath,
        reason: '强行合并到产品页',
      },
      existingByPath: new Map(candidates.map((item) => [item.wikiPath, item])),
    })
    expect(plan.rejectedForcedUpdate).toBe(true)
    expect(plan.action).toBe('create')
  })

  // §11.3 有密钥：微调 docx → update
  it.skipIf(!hasAiKey)('§11.3 有密钥：微调 docx 再次导入走 update', async () => {
    const { Document, Packer, Paragraph, TextRun } = await import('docx')
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('s11-reimport-update')
    const siteId = 's11-reimport-update'
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
      enableIngest: true,
    })
    try {
      await ensureProject(baseUrl, siteId)
      const sourceRel = 'product/spec.docx'
      const sourcePath = `raw/sources/${sourceRel}`
      const buildDocx = async (text: string): Promise<Buffer> => {
        const doc = new Document({
          sections: [{ children: [new Paragraph({ children: [new TextRun(text)] })] }],
        })
        return Buffer.from(await Packer.toBuffer(doc))
      }
      const firstDocx = await buildDocx('s11-product-spec-version-one')
      const firstRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'spec-v1',
          files: [{ relativePath: sourceRel, contentBase64: toBase64(firstDocx) }],
        }),
      })
      expect(firstRes.status).toBe(202)
      const { importId: firstId } = (await firstRes.json()) as { importId: string }
      await waitForImportCompleted(baseUrl, siteId, firstId)

      const projectDir = path.join(knowledgeRoot, siteId)
      const wikiFirst = (await readFingerprintStore(projectDir))[sourcePath]?.wikiPath
      expect(wikiFirst).toBeTruthy()

      const secondDocx = await buildDocx('s11-product-spec-version-two lightly edited')
      const secondRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'spec-v2',
          files: [{ relativePath: sourceRel, contentBase64: toBase64(secondDocx) }],
        }),
      })
      expect(secondRes.status).toBe(202)
      const { importId: secondId } = (await secondRes.json()) as { importId: string }
      const second = await waitForImportCompleted(baseUrl, siteId, secondId)
      expect(second.stats.ingestPagesUpdated).toBeGreaterThanOrEqual(1)
      expect((await readFingerprintStore(projectDir))[sourcePath]?.wikiPath).toBe(wikiFirst)
      const wikiRaw = await fs.readFile(path.join(projectDir, ...wikiFirst!.split('/')), 'utf8')
      expect(wikiRaw).toContain('version-two')
    } finally {
      close()
    }
  })

  // §11.5
  it('§11.5 超限、坏路径、不支持类型给出明确错误或跳过统计', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('s11-errors')
    const siteId = 's11-errors'
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
      importMaxBytes: 200,
      singleFileMaxBytes: 150,
    })
    try {
      await ensureProject(baseUrl, siteId)

      const oversize = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'oversize',
          files: [
            { relativePath: 'a.bin', contentBase64: toBase64(new Uint8Array(120)) },
            { relativePath: 'b.bin', contentBase64: toBase64(new Uint8Array(120)) },
          ],
        }),
      })
      expect(oversize.status).toBe(400)
      expect(((await oversize.json()) as { error: string }).error).toBe('import_total_size_exceeded')

      const badPath = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'escape',
          files: [{ relativePath: '../escape.txt', contentBase64: toBase64(Buffer.from('x\n', 'utf8')) }],
        }),
      })
      expect(badPath.status).toBe(400)
      expect(((await badPath.json()) as { error: string }).error).toBe('import_invalid_path')

      const unsupported = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'unsupported',
          files: [
            {
              relativePath: 'odd/unknown.foo',
              contentBase64: toBase64(Buffer.from('unsupported-bytes\n', 'utf8')),
            },
          ],
        }),
      })
      expect(unsupported.status).toBe(202)
      const { importId } = (await unsupported.json()) as { importId: string }
      const done = await waitForImportCompleted(baseUrl, siteId, importId, 30_000)
      expect(done.stats.skipped).toBeGreaterThanOrEqual(1)
      expect(done.stats.extracted ?? 0).toBe(0)
    } finally {
      close()
    }
  })

  // §11.7
  it('§11.7 MCP olps_knowledge_search 与 read_file 在服务启动后可用', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('s11-mcp')
    const siteId = 's11-mcp'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const projectDir = path.join(knowledgeRoot, siteId)
      await fs.writeFile(
        path.join(projectDir, 'wiki', 'acceptance-product.md'),
        '# 验收洗碗机说明\n\n验收洗碗机支持蒸汽洗。\n',
        'utf8',
      )

      const client = createKnowledgeHttpClient({ baseUrl, serviceToken: token })
      const search = await invokeKnowledgeTool(client, 'olps_knowledge_search', {
        siteId,
        query: '验收洗碗机',
      })
      expect(search.isError).toBeFalsy()
      const searchBody = JSON.parse(mcpText(search)) as { hits: Array<{ path: string }> }
      expect(searchBody.hits.some((hit) => hit.path === 'wiki/acceptance-product.md')).toBe(true)

      const readFile = await invokeKnowledgeTool(client, 'olps_knowledge_read_file', {
        siteId,
        path: 'wiki/index.md',
      })
      expect(readFile.isError).toBeFalsy()
      const readBody = JSON.parse(mcpText(readFile)) as { path: string; content?: string }
      expect(readBody.path).toBe('wiki/index.md')
      expect(String(readBody.content)).toContain('Knowledge index')
    } finally {
      close()
    }
  })
})

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { resumeIngestForImport } from './import-service.js'
import { runIngestPipeline } from './ingest-service.js'
import { readFingerprintStore } from './project-fingerprints.js'
import { processImportedSources } from './source-processing.js'
import { loadKnowledgeAiConfig } from './ai-config.js'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'
import { ensureKnowledgeProject } from './project-layout.js'
import { ensureW2T3Fixtures } from './w2t3-fixture-builder.js'

const token = 'knowledge-test-token'

function requireAiKey(): void {
  const cfg = loadKnowledgeAiConfig(process.env)
  if (!cfg.apiKey.trim()) {
    throw new Error('缺少 AI_API_KEY 或 KNOWLEDGE_AI_API_KEY，无法运行 Ingest 集成测试')
  }
}

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

function toBase64(bytes: Buffer): string {
  return bytes.toString('base64')
}

async function waitForImportCompleted(
  baseUrl: string,
  siteId: string,
  importId: string,
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports/${importId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; error: string | null }
    if (body.status === 'completed') {
      return
    }
    if (body.status === 'failed') {
      throw new Error(`import failed: ${body.error ?? 'unknown'}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`import ${importId} timeout`)
}

async function countWikiSourceMarkdown(projectDir: string): Promise<number> {
  const roots = [
    path.join(projectDir, 'wiki', 'sources', 'files'),
    path.join(projectDir, 'wiki', 'sources', 'imported'),
    path.join(projectDir, 'wiki', 'sources', 'products'),
  ]
  let total = 0
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        total += 1
      }
    }
  }
  for (const root of roots) {
    await walk(root)
  }
  return total
}

async function importProductPack(
  baseUrl: string,
  siteId: string,
  fixtureDir: string,
): Promise<string> {
  const docx = await fs.readFile(path.join(fixtureDir, 'sample.docx'))
  const xlsx = await fs.readFile(path.join(fixtureDir, 'sample.xlsx'))
  const create = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
    method: 'POST',
    body: JSON.stringify({
      sourceName: 'product-pack',
      files: [
        { relativePath: 'product/spec.docx', contentBase64: toBase64(docx) },
        { relativePath: 'product/price.xlsx', contentBase64: toBase64(xlsx) },
      ],
    }),
  })
  expect(create.status).toBe(202)
  const { importId } = (await create.json()) as { importId: string }
  await waitForImportCompleted(baseUrl, siteId, importId)
  return importId
}

const hasAiKey = Boolean(loadKnowledgeAiConfig(process.env).apiKey.trim())

describe.skipIf(!hasAiKey)('W3-T1 两步 Ingest 流水线', () => {
  beforeAll(async () => {
    requireAiKey()
    await ensureW2T3Fixtures()
  })

  it('产品包 docx+xlsx 导入后 Wiki 来源页数不少于文字文件数', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('w3t1-product-pack')
    const siteId = 'w3t1-product-pack'
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
      enableIngest: true,
    })
    try {
      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
      expect(res.status).toBe(200)
      const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'w2t3')
      await importProductPack(baseUrl, siteId, fixtureDir)
      const projectDir = path.join(knowledgeRoot, siteId)
      const sourcePages = await countWikiSourceMarkdown(projectDir)
      expect(sourcePages).toBeGreaterThanOrEqual(2)
      const index = await fs.readFile(path.join(projectDir, 'wiki/index.md'), 'utf8')
      const log = await fs.readFile(path.join(projectDir, 'wiki/log.md'), 'utf8')
      const overview = await fs.readFile(path.join(projectDir, 'wiki/overview.md'), 'utf8')
      expect(index.length).toBeGreaterThan(20)
      expect(log.length).toBeGreaterThan(20)
      expect(overview.length).toBeGreaterThan(20)
    } finally {
      close()
    }
  })

  it('同一 importId 中断后续跑不因指纹未变重复生成来源页', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('w3t1-ingest-resume')
    const siteId = 'w3t1-ingest-resume'
    const importId = '00000000-0000-4000-8000-000000000001'
    const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'w2t3')
    const docx = await fs.readFile(path.join(fixtureDir, 'sample.docx'))
    const xlsx = await fs.readFile(path.join(fixtureDir, 'sample.xlsx'))
    await ensureKnowledgeProject(knowledgeRoot, siteId)
    const projectDir = path.join(knowledgeRoot, siteId)
    const writtenPaths: string[] = []
    for (const [rel, bytes] of [
      ['product/spec.docx', docx],
      ['product/price.xlsx', xlsx],
    ] as const) {
      const relUnder = `raw/sources/${rel}`
      const abs = path.join(projectDir, ...relUnder.split('/'))
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, bytes)
      writtenPaths.push(relUnder)
    }
    await fs.mkdir(path.join(projectDir, '.olps-knowledge', 'imports', importId), { recursive: true })
    await fs.writeFile(
      path.join(projectDir, '.olps-knowledge', 'imports', importId, 'status.json'),
      `${JSON.stringify(
        {
          importId,
          siteId,
          sourceName: 'resume-pack',
          draftId: null,
          status: 'processing',
          stats: { fileCount: 2, totalBytes: docx.length + xlsx.length, writtenPaths, extracted: 0, skipped: 0, fingerprintSkips: 0, assetsRegistered: 0, ingestPagesWritten: 0, ingestPagesSkipped: 0 },
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await processImportedSources(projectDir, writtenPaths, importId)
    const ai = loadKnowledgeAiConfig(process.env)
    let interrupted = false
    try {
      await runIngestPipeline({
        projectDir,
        importId,
        writtenPaths,
        ai,
        interruptAfter: 1,
      })
    } catch {
      interrupted = true
    }
    expect(interrupted).toBe(true)
    const afterInterrupt = await countWikiSourceMarkdown(projectDir)
    expect(afterInterrupt).toBeGreaterThanOrEqual(1)
    await resumeIngestForImport({
      knowledgeRoot,
      siteId,
      importId,
      ai,
    })
    const afterResume = await countWikiSourceMarkdown(projectDir)
    expect(afterResume).toBeGreaterThanOrEqual(2)
    expect(afterResume).toBe(afterInterrupt + 1)
    const store = await readFingerprintStore(projectDir)
    const wikiPaths = new Set<string>()
    for (const entry of Object.values(store)) {
      if (entry.wikiPath) {
        if (wikiPaths.has(entry.wikiPath)) {
          throw new Error(`重复的 wiki 页: ${entry.wikiPath}`)
        }
        wikiPaths.add(entry.wikiPath)
      }
    }
    await resumeIngestForImport({
      knowledgeRoot,
      siteId,
      importId,
      ai,
    })
    const afterSecondResume = await countWikiSourceMarkdown(projectDir)
    expect(afterSecondResume).toBe(afterResume)
  })
})
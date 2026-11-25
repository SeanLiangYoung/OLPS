import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { beforeAll, describe, expect, it } from 'vitest'
import { finalizeReimportIngestDecision, type WikiSourceCandidate } from './ingest-reimport.js'
import { loadKnowledgeAiConfig } from './ai-config.js'
import { readFingerprintStore } from './project-fingerprints.js'
import { readProjectReviews } from './project-reviews.js'
import { stableDocumentId } from './projection-sync.js'
import { wikiPathForImportedSource } from './source-wiki-path.js'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'
import { ensureW2T3Fixtures } from './w2t3-fixture-builder.js'

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

function toBase64(bytes: Buffer): string {
  return bytes.toString('base64')
}

type ImportStatusBody = {
  status: string
  stats: {
    sourceBytesWritten?: number
    fingerprintSkips?: number
    ingestPagesUpdated?: number
    ingestRejectedUpdates?: number
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
      throw new Error('import failed')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`import ${importId} timeout`)
}

async function ensureProject(baseUrl: string, siteId: string): Promise<void> {
  const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
  expect(res.status).toBe(200)
}

async function buildDocx(text: string): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun(text)] })] }],
  })
  return Buffer.from(await Packer.toBuffer(doc))
}

const hasAiKey = Boolean(loadKnowledgeAiConfig(process.env).apiKey.trim())

describe('W3-T3 再次导入（规则，无模型）', () => {
  it('无关主题强制 update 被拒绝并允许 create', async () => {
    const sourcePath = 'raw/sources/theme/new-unrelated.docx'
    const canonicalWikiPath = wikiPathForImportedSource(sourcePath)
    const foreignWikiPath = 'wiki/sources/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md'
    const candidates: WikiSourceCandidate[] = [
      {
        wikiPath: foreignWikiPath,
        title: '产品规格',
        sourcePath: 'raw/sources/product/spec.docx',
        snippet: '产品规格与参数',
        fingerprint: 'a'.repeat(64),
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
    expect(plan.wikiPath).toBe(canonicalWikiPath)

    const knowledgeRoot = await makeIsolatedKnowledgeRoot('w3t3-reject-review')
    const siteId = 'w3t3-reject-review'
    const projectDir = path.join(knowledgeRoot, siteId)
    await fs.mkdir(path.join(projectDir, 'wiki', 'sources', 'files'), { recursive: true })
    await fs.mkdir(path.join(projectDir, '.olps-knowledge'), { recursive: true })
    await fs.writeFile(path.join(projectDir, '.olps-knowledge', 'reviews.json'), '[]\n')
    await fs.writeFile(
      path.join(projectDir, foreignWikiPath.split('/').join(path.sep)),
      [
        '---',
        'title: "产品规格"',
        'kind: imported_source',
        `sourcePath: "raw/sources/product/spec.docx"`,
        `sourceFingerprint: "${'a'.repeat(64)}"`,
        '---',
        '',
        '产品规格正文',
      ].join('\n'),
      'utf8',
    )

    const { appendIngestRejectedUpdateReview } = await import('./project-reviews.js')
    await appendIngestRejectedUpdateReview(projectDir, {
      importId: '00000000-0000-4000-8000-000000000001',
      sourcePath,
      attemptedTargetWikiPath: foreignWikiPath,
      aiReason: '强行合并到产品页',
    })
    const reviews = await readProjectReviews(projectDir)
    expect(reviews.some((item) => item.kind === 'ingest_rejected_update')).toBe(true)
  })

  it('相同图片指纹再次导入时 sourceBytesWritten 为 0', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('w3t3-img-skip-bytes')
    const siteId = 'w3t3-img-skip-bytes'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'w2t3')
      const png = await fs.readFile(path.join(fixtureDir, 'sample.png'))
      const entry = { relativePath: 'repeat/logo.png', contentBase64: toBase64(png) }
      const firstCreate = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'img-first', files: [entry] }),
      })
      expect(firstCreate.status).toBe(202)
      const { importId: firstId } = (await firstCreate.json()) as { importId: string }
      const first = await waitForImportCompleted(baseUrl, siteId, firstId, 30_000)
      expect(first.stats.sourceBytesWritten).toBe(png.length)

      const secondCreate = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'img-second', files: [entry] }),
      })
      expect(secondCreate.status).toBe(202)
      const { importId: secondId } = (await secondCreate.json()) as { importId: string }
      const second = await waitForImportCompleted(baseUrl, siteId, secondId, 30_000)
      expect(second.stats.sourceBytesWritten).toBe(0)
      expect(second.stats.fingerprintSkips).toBeGreaterThanOrEqual(1)

      const projectDir = path.join(knowledgeRoot, siteId)
      const store = await readFingerprintStore(projectDir)
      const sourcePath = 'raw/sources/repeat/logo.png'
      const assetIdFirst = store[sourcePath]?.assetId
      expect(assetIdFirst).toBeTruthy()
      const storeAfter = await readFingerprintStore(projectDir)
      expect(storeAfter[sourcePath]?.assetId).toBe(assetIdFirst)
    } finally {
      close()
    }
  })
})

describe.skipIf(!hasAiKey)('W3-T3 再次导入（模型）', () => {
  beforeAll(async () => {
    await ensureW2T3Fixtures()
  })

  it('微调 docx 再次导入走 update 且 wiki 与 document id 不变', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('w3t3-docx-update')
    const siteId = 'w3t3-docx-update'
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
      enableIngest: true,
    })
    try {
      await ensureProject(baseUrl, siteId)
      const sourceRel = 'product/spec.docx'
      const sourcePath = `raw/sources/${sourceRel}`
      const firstDocx = await buildDocx('w3t3-product-spec-version-one')
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
      const storeFirst = await readFingerprintStore(projectDir)
      const wikiFirst = storeFirst[sourcePath]?.wikiPath
      expect(wikiFirst).toBeTruthy()
      const kbId = createHash('sha256').update(`kb\0${siteId}`).digest('hex').slice(0, 32)
      const docIdFirst = stableDocumentId(kbId, sourcePath)

      const secondDocx = await buildDocx('w3t3-product-spec-version-two lightly edited')
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

      const storeSecond = await readFingerprintStore(projectDir)
      expect(storeSecond[sourcePath]?.wikiPath).toBe(wikiFirst)
      const docIdSecond = stableDocumentId(kbId, sourcePath)
      expect(docIdSecond).toBe(docIdFirst)
      expect(second.stats.ingestPagesUpdated).toBeGreaterThanOrEqual(1)

      const wikiRaw = await fs.readFile(path.join(projectDir, ...wikiFirst!.split('/')), 'utf8')
      expect(wikiRaw).toContain('version-two')
    } finally {
      close()
    }
  })
})
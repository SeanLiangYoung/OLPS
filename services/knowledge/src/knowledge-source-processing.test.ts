import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { readAssetMeta } from './asset-meta.js'
import { readExtractedText } from './source-processing.js'
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

async function ensureProject(baseUrl: string, siteId: string): Promise<void> {
  const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
  expect(res.status).toBe(200)
}

function toBase64(bytes: Buffer): string {
  return bytes.toString('base64')
}

type ImportStatusBody = {
  status: string
  stats: {
    fileCount: number
    extracted: number
    skipped: number
    fingerprintSkips: number
    assetsRegistered: number
    writtenPaths?: string[]
  }
}

async function waitForImportCompleted(
  baseUrl: string,
  siteId: string,
  importId: string,
): Promise<ImportStatusBody> {
  const deadline = Date.now() + 30_000
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
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`import ${importId} timeout, last=${last?.status}`)
}

async function importFixtureFiles(
  baseUrl: string,
  siteId: string,
  entries: Array<{ relativePath: string; fileName: string }>,
): Promise<ImportStatusBody> {
  const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'w2t3')
  const files = await Promise.all(
    entries.map(async (entry) => {
      const bytes = await fs.readFile(path.join(fixtureDir, entry.fileName))
      return { relativePath: entry.relativePath, contentBase64: toBase64(bytes) }
    }),
  )
  const create = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
    method: 'POST',
    body: JSON.stringify({ sourceName: 'w2t3-fixtures', files }),
  })
  expect(create.status).toBe(202)
  const { importId } = (await create.json()) as { importId: string }
  return waitForImportCompleted(baseUrl, siteId, importId)
}

describe('W2-T3 源文件分类与文本抽取', () => {
  beforeAll(async () => {
    await ensureW2T3Fixtures()
  })

  const textCases = [
    { fileName: 'sample.txt', needle: 'plain-text-body' },
    { fileName: 'sample.md', needle: 'markdown-body' },
    { fileName: 'sample.csv', needle: 'col1,col2' },
    { fileName: 'sample.docx', needle: 'docx-extracted-text' },
    { fileName: 'sample.xlsx', needle: 'widget' },
    { fileName: 'sample.pdf', needle: 'pdf-extracted-text' },
  ] as const

  for (const item of textCases) {
    it(`文字源 ${item.fileName} 导入后可读抽出文本`, async () => {
      const knowledgeRoot = await makeIsolatedKnowledgeRoot(`w2t3-text-${item.fileName}`)
      const siteId = `w2t3-text-${item.fileName.replace(/\./g, '-')}`
      const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
      try {
        await ensureProject(baseUrl, siteId)
        await importFixtureFiles(baseUrl, siteId, [{ relativePath: `text/${item.fileName}`, fileName: item.fileName }])
        const projectDir = path.join(knowledgeRoot, siteId)
        const sourcePath = `raw/sources/text/${item.fileName}`
        const extracted = await readExtractedText(projectDir, sourcePath)
        expect(extracted.text).toContain(item.needle)
        const store = JSON.parse(
          await fs.readFile(path.join(projectDir, '.olps-knowledge/fingerprints.json'), 'utf8'),
        ) as Record<string, { sha256: string; kind: string }>
        expect(store[sourcePath]?.kind).toBe('text')
        expect(store[sourcePath]?.sha256).toMatch(/^[a-f0-9]{64}$/)
      } finally {
        close()
      }
    })
  }

  const imageCases = [
    'sample.png',
    'sample.jpg',
    'sample.jpeg',
    'sample.webp',
    'sample.gif',
    'sample.svg',
  ] as const

  for (const fileName of imageCases) {
    it(`图片源 ${fileName} 导入后登记 mime 与尺寸（若可读）`, async () => {
      const knowledgeRoot = await makeIsolatedKnowledgeRoot(`w2t3-img-${fileName}`)
      const siteId = `w2t3-img-${fileName.replace(/\./g, '-')}`
      const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
      try {
        await ensureProject(baseUrl, siteId)
        const done = await importFixtureFiles(baseUrl, siteId, [{ relativePath: `img/${fileName}`, fileName }])
        expect(done.stats.assetsRegistered).toBe(1)
        const projectDir = path.join(knowledgeRoot, siteId)
        const sourcePath = `raw/sources/img/${fileName}`
        const store = JSON.parse(
          await fs.readFile(path.join(projectDir, '.olps-knowledge/fingerprints.json'), 'utf8'),
        ) as Record<string, { assetId: string }>
        const assetId = store[sourcePath]?.assetId
        expect(assetId).toBeTruthy()
        const meta = await readAssetMeta(projectDir, assetId)
        expect(meta.mime.startsWith('image/')).toBe(true)
        expect(meta.sizeBytes).toBeGreaterThan(0)
        if (fileName !== 'sample.svg') {
          expect(meta.width).toBeGreaterThan(0)
          expect(meta.height).toBeGreaterThan(0)
        } else {
          expect(meta.width).toBe(20)
          expect(meta.height).toBe(12)
        }
      } finally {
        close()
      }
    })
  }

  for (const fileName of ['sample.mp4', 'sample.webm'] as const) {
    it(`视频源 ${fileName} 导入后登记 mime 与大小`, async () => {
      const knowledgeRoot = await makeIsolatedKnowledgeRoot(`w2t3-vid-${fileName}`)
      const siteId = `w2t3-vid-${fileName.replace(/\./g, '-')}`
      const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
      try {
        await ensureProject(baseUrl, siteId)
        await importFixtureFiles(baseUrl, siteId, [{ relativePath: `vid/${fileName}`, fileName }])
        const projectDir = path.join(knowledgeRoot, siteId)
        const sourcePath = `raw/sources/vid/${fileName}`
        const store = JSON.parse(
          await fs.readFile(path.join(projectDir, '.olps-knowledge/fingerprints.json'), 'utf8'),
        ) as Record<string, { assetId: string }>
        const meta = await readAssetMeta(projectDir, store[sourcePath].assetId)
        expect(meta.mime.startsWith('video/')).toBe(true)
        expect(meta.sizeBytes).toBeGreaterThan(0)
        expect(meta.width).toBeUndefined()
        expect(meta.height).toBeUndefined()
      } finally {
        close()
      }
    })
  }

  it('混合包含未知扩展名时 skipped≥1 且其它文件仍成功', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('w2t3-mixed-skip')
    const siteId = 'w2t3-mixed-skip'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const done = await importFixtureFiles(baseUrl, siteId, [
        { relativePath: 'mixed/known.txt', fileName: 'sample.txt' },
        { relativePath: 'mixed/unknown.foo', fileName: 'unknown.foo' },
      ])
      expect(done.status).toBe('completed')
      expect(done.stats.skipped).toBeGreaterThanOrEqual(1)
      expect(done.stats.extracted).toBeGreaterThanOrEqual(1)
      const projectDir = path.join(knowledgeRoot, siteId)
      const extracted = await readExtractedText(projectDir, 'raw/sources/mixed/known.txt')
      expect(extracted.text).toContain('plain-text-body')
    } finally {
      close()
    }
  })

  it('指纹未变时第二次处理 fingerprintSkips≥1', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('w2t3-fingerprint-skip')
    const siteId = 'w2t3-fingerprint-skip'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const entry = { relativePath: 'repeat/sample.txt', fileName: 'sample.txt' }
      const first = await importFixtureFiles(baseUrl, siteId, [entry])
      expect(first.stats.fingerprintSkips).toBe(0)
      const second = await importFixtureFiles(baseUrl, siteId, [entry])
      expect(second.stats.fingerprintSkips).toBeGreaterThanOrEqual(1)
    } finally {
      close()
    }
  })
})
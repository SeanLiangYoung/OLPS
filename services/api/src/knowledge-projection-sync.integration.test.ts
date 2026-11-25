import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { afterAll, expect, it } from 'vitest'
import { inject } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { knowledgeIntegrationToken } from './test-support/knowledge-process.js'

const database = createTestPool()
afterAll(async () => {
  await database.end()
})

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function buildZip(files: Record<string, string>): string {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, text] of Object.entries(files)) {
    entries[name] = strToU8(text)
  }
  return toBase64(zipSync(entries))
}

async function knowledgeFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const base = process.env.KNOWLEDGE_SERVICE_URL!
  const token = process.env.KNOWLEDGE_SERVICE_TOKEN ?? knowledgeIntegrationToken
  return fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

async function waitImportCompleted(siteId: string, importId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 60_000
  let last: Record<string, unknown> | null = null
  while (Date.now() < deadline) {
    const res = await knowledgeFetch(`/api/v1/projects/${siteId}/imports/${importId}`)
    expect(res.status).toBe(200)
    last = (await res.json()) as Record<string, unknown>
    if (last.status === 'completed') return last
    if (last.status === 'failed') throw new Error(String(last.error))
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`导入未完成，末次状态=${String(last?.status)}`)
}

it('导入并抽取后文档列表从投影读取 kind 与 sourcePath', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'proj-owner', password: 'Knowledge123!', name: '投影管理员' })
  const created = await requestJson(app, 'POST', '/api/sites', { token: owner.accessToken, body: { name: '投影站' } })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  await expect.poll(async () => {
    const result = await requestJson(app, 'GET', `/api/sites/${siteId}/initialization`, { token: owner.accessToken })
    if (result.body.initStatus === 'failed') throw new Error(String(result.body.error))
    return result.body.initStatus
  }, { timeout: 30_000 }).toBe('ready')

  const zipBase64 = buildZip({ 'docs/intro.md': '# 简介\n产品线 A\n' })
  const createRes = await knowledgeFetch(`/api/v1/projects/${siteId}/imports`, {
    method: 'POST',
    body: JSON.stringify({ sourceName: 'intro.zip', zipBase64 }),
  })
  expect(createRes.status).toBe(202)
  const createdImport = (await createRes.json()) as { importId: string }
  const importStatus = await waitImportCompleted(siteId, createdImport.importId)
  const stats = importStatus.stats as Record<string, unknown>

  const listRes = await requestJson(app, 'GET', `/api/sites/${siteId}/knowledge-base/documents`, { token: owner.accessToken })
  expect(listRes.status).toBe(200)
  const documents = listRes.body.documents as Array<Record<string, unknown>>
  const projected = documents.find((doc) => doc.sourcePath === 'raw/sources/docs/intro.md')
  expect(projected).toBeDefined()
  expect(projected!.kind).toBe('imported_text')
  expect(String(projected!.content)).toContain('产品线 A')

  const importRows = await database.query('SELECT count(*)::int AS c FROM knowledge_imports WHERE site_id=$1', [siteId])
  expect(importRows.rows[0].c).toBe(1)
  const docRows = await database.query(
    "SELECT count(*)::int AS c FROM knowledge_documents d JOIN knowledge_bases k USING(kb_id) WHERE k.site_id=$1 AND d.kind='imported_text'",
    [siteId],
  )
  expect(docRows.rows[0].c).toBe(Number(stats.extracted))
}, 120_000)

it('手工篡改投影正文后重建与抽取源一致', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'proj-rebuild', password: 'Knowledge123!', name: '重建管理员' })
  const created = await requestJson(app, 'POST', '/api/sites', { token: owner.accessToken, body: { name: '重建站' } })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  await expect.poll(async () => {
    const result = await requestJson(app, 'GET', `/api/sites/${siteId}/initialization`, { token: owner.accessToken })
    if (result.body.initStatus === 'failed') throw new Error(String(result.body.error))
    return result.body.initStatus
  }, { timeout: 30_000 }).toBe('ready')

  const zipBase64 = buildZip({ 'pack/note.txt': '权威正文\n' })
  const createRes = await knowledgeFetch(`/api/v1/projects/${siteId}/imports`, {
    method: 'POST',
    body: JSON.stringify({ sourceName: 'pack.zip', zipBase64 }),
  })
  const createdImport = (await createRes.json()) as { importId: string }
  await waitImportCompleted(siteId, createdImport.importId)

  const kb = (await database.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1', [siteId])).rows[0]
  await database.query(
    "UPDATE knowledge_documents SET content='被篡改' WHERE kb_id=$1 AND source_path='raw/sources/pack/note.txt'",
    [kb.kb_id],
  )

  const rebuildRes = await knowledgeFetch(`/api/v1/projects/${siteId}/projection/rebuild`, {
    method: 'POST',
    body: JSON.stringify({ importId: createdImport.importId }),
  })
  expect(rebuildRes.status).toBe(200)

  const listRes = await requestJson(app, 'GET', `/api/sites/${siteId}/knowledge-base/documents`, { token: owner.accessToken })
  const documents = listRes.body.documents as Array<Record<string, unknown>>
  const projected = documents.find((doc) => doc.sourcePath === 'raw/sources/pack/note.txt')
  expect(projected?.content).toBe('权威正文\n')
}, 120_000)

it('导入统计与投影表行数一致', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'proj-stats', password: 'Knowledge123!', name: '统计管理员' })
  const created = await requestJson(app, 'POST', '/api/sites', { token: owner.accessToken, body: { name: '统计站' } })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  await expect.poll(async () => {
    const result = await requestJson(app, 'GET', `/api/sites/${siteId}/initialization`, { token: owner.accessToken })
    if (result.body.initStatus === 'failed') throw new Error(String(result.body.error))
    return result.body.initStatus
  }, { timeout: 30_000 }).toBe('ready')

  const knowledgeRoot = inject('knowledgeDataRoot')
  const tinyPng = await fs.readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../knowledge/test-fixtures/w2t3/sample.png'),
  )
  const createRes = await knowledgeFetch(`/api/v1/projects/${siteId}/imports`, {
    method: 'POST',
    body: JSON.stringify({
      sourceName: 'mixed',
      files: [
        { relativePath: 'a.md', contentBase64: toBase64(strToU8('alpha')) },
        { relativePath: 'logo.png', contentBase64: tinyPng.toString('base64') },
        { relativePath: 'unknown.xyz', contentBase64: toBase64(strToU8('skip')) },
      ],
    }),
  })
  expect(createRes.status).toBe(202)
  const createdImport = (await createRes.json()) as { importId: string }
  const importStatus = await waitImportCompleted(siteId, createdImport.importId)
  const stats = importStatus.stats as Record<string, unknown>

  const kb = (await database.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1', [siteId])).rows[0]
  const docCount = (
    await database.query(
      'SELECT count(*)::int AS c FROM knowledge_documents WHERE kb_id=$1 AND import_id=$2',
      [kb.kb_id, createdImport.importId],
    )
  ).rows[0].c
  const assetCount = (
    await database.query(
      'SELECT count(*)::int AS c FROM knowledge_assets WHERE kb_id=$1 AND import_id=$2',
      [kb.kb_id, createdImport.importId],
    )
  ).rows[0].c

  expect(docCount + assetCount).toBe(Number(stats.extracted))
  expect(Number(stats.skipped)).toBeGreaterThanOrEqual(1)

  const statusFile = await fs.readFile(
    path.join(knowledgeRoot, siteId, '.olps-knowledge', 'imports', createdImport.importId, 'status.json'),
    'utf8',
  )
  const statusRecord = JSON.parse(statusFile) as { stats: Record<string, unknown> }
  const projectedImport = (
    await database.query('SELECT stats FROM knowledge_imports WHERE import_id=$1', [createdImport.importId])
  ).rows[0]
  expect(projectedImport.stats).toEqual(statusRecord.stats)
}, 120_000)
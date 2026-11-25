import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it, inject } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { knowledgeIntegrationToken } from './test-support/knowledge-process.js'

const database = createTestPool()
afterAll(async () => {
  await database.end()
})

function manualRawPath(documentId: string): string {
  return `raw/sources/manual/${documentId}.md`
}

async function readKnowledgeFile(siteId: string, relativePath: string): Promise<string> {
  const base = process.env.KNOWLEDGE_SERVICE_URL!
  const token = process.env.KNOWLEDGE_SERVICE_TOKEN ?? knowledgeIntegrationToken
  const url = `${base}/api/v1/projects/${encodeURIComponent(siteId)}/files/content?path=${encodeURIComponent(relativePath)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { content?: string }
  expect(body.content).toBeDefined()
  return body.content!
}

async function createReadySite(token: string, name: string): Promise<string> {
  const created = await requestJson(app, 'POST', '/api/sites', { token, body: { name } })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  await expect.poll(async () => {
    const result = await requestJson(app, 'GET', `/api/sites/${siteId}/initialization`, { token })
    if (result.body.initStatus === 'failed') throw new Error(String(result.body.error))
    return result.body.initStatus
  }, { timeout: 30_000 }).toBe('ready')
  return siteId
}

it('创建、更新、删除经门面写入后 Wiki 抽取与投影一致', async () => {
  await resetTestDatabase()
  const knowledgeRoot = inject('knowledgeDataRoot')
  const owner = await registerUser(app, { account: 'manual-crud', password: 'Knowledge123!', name: '手工资料' })
  const siteId = await createReadySite(owner.accessToken, '手工站')
  const docsPath = `/api/sites/${siteId}/knowledge-base/documents`

  const created = await requestJson(app, 'POST', docsPath, {
    token: owner.accessToken,
    body: { title: '产品说明', content: '正文 v1' },
  })
  expect(created.status).toBe(201)
  const documentId = String((created.body.document as Record<string, unknown>).documentId)
  expect(documentId.length).toBeGreaterThan(10)

  const list1 = await requestJson(app, 'GET', docsPath, { token: owner.accessToken })
  const row1 = (list1.body.documents as Array<Record<string, unknown>>).find((d) => d.documentId === documentId)
  expect(row1).toBeDefined()
  expect(row1!.kind).toBe('manual')
  expect(row1!.title).toBe('产品说明')
  expect(row1!.content).toBe('正文 v1')
  expect(String(row1!.sourcePath)).toBe(manualRawPath(documentId))

  const rawText = await readKnowledgeFile(siteId, manualRawPath(documentId))
  expect(rawText).toContain('正文 v1')
  expect(rawText).toContain('产品说明')

  const wikiText = await readKnowledgeFile(siteId, `wiki/sources/manual/${documentId}.md`)
  expect(wikiText).toContain('正文 v1')

  const extractedPath = path.join(
    knowledgeRoot,
    siteId,
    '.olps-knowledge',
    'extracted',
    `${manualRawPath(documentId)}.json`,
  )
  const extracted = JSON.parse(await fs.readFile(extractedPath, 'utf8')) as { text: string; fingerprint: string }
  expect(extracted.text).toContain('正文 v1')

  const pgRow = (
    await database.query('SELECT title, content, kind, source_path, source_fingerprint FROM knowledge_documents WHERE doc_id=$1', [
      documentId,
    ])
  ).rows[0]
  expect(pgRow.title).toBe('产品说明')
  expect(pgRow.content).toBe('正文 v1')
  expect(pgRow.kind).toBe('manual')
  expect(pgRow.source_path).toBe(manualRawPath(documentId))
  expect(pgRow.source_fingerprint).toBe(extracted.fingerprint)

  const updated = await requestJson(app, 'PUT', `${docsPath}/${documentId}`, {
    token: owner.accessToken,
    body: { title: '产品说明', content: '正文 v2' },
  })
  expect(updated.status).toBe(200)
  expect((updated.body.document as Record<string, unknown>).content).toBe('正文 v2')
  expect(await readKnowledgeFile(siteId, manualRawPath(documentId))).toContain('正文 v2')
  const pgAfter = (await database.query('SELECT content FROM knowledge_documents WHERE doc_id=$1', [documentId])).rows[0]
  expect(pgAfter.content).toBe('正文 v2')

  const deleted = await requestJson(app, 'DELETE', `${docsPath}/${documentId}`, { token: owner.accessToken })
  expect(deleted.status).toBe(204)
  expect((await requestJson(app, 'GET', `${docsPath}/${documentId}`, { token: owner.accessToken })).status).toBe(404)
  await expect(fs.access(path.join(knowledgeRoot, siteId, ...manualRawPath(documentId).split('/')))).rejects.toThrow()
  expect((await database.query('SELECT count(*)::int AS c FROM knowledge_documents WHERE doc_id=$1', [documentId])).rows[0].c).toBe(0)
}, 120_000)

it('复制到两个站点产生不同 documentId 且改来源不影响目标', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'manual-copy', password: 'Knowledge123!', name: '复制资料' })
  const siteA = await createReadySite(owner.accessToken, '复制甲')
  const siteB = await createReadySite(owner.accessToken, '复制乙')
  const siteC = await createReadySite(owner.accessToken, '复制丙')
  const sourcePath = `/api/sites/${siteA}/knowledge-base/documents`
  const created = await requestJson(app, 'POST', sourcePath, {
    token: owner.accessToken,
    body: { title: '源资料', content: '源正文' },
  })
  const documentId = String((created.body.document as Record<string, unknown>).documentId)
  const copied = await requestJson(app, 'POST', `${sourcePath}/${documentId}/copy`, {
    token: owner.accessToken,
    body: { targetSiteIds: [siteB, siteC] },
  })
  expect(copied.status).toBe(201)
  const copies = copied.body.copies as Array<{ siteId: string; documentId: string }>
  expect(copies).toHaveLength(2)
  expect(new Set(copies.map((c) => c.documentId)).size).toBe(2)
  expect(copies.every((c) => c.documentId !== documentId)).toBe(true)

  await requestJson(app, 'PUT', `${sourcePath}/${documentId}`, {
    token: owner.accessToken,
    body: { title: '源资料', content: '已改来源' },
  })
  for (const target of [siteB, siteC]) {
    const list = await requestJson(app, 'GET', `/api/sites/${target}/knowledge-base/documents`, { token: owner.accessToken })
    const rows = list.body.documents as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('源正文')
  }
  const changedTargets = await database.query(
    "SELECT count(*)::int AS c FROM knowledge_documents WHERE content='已改来源' AND doc_id=ANY($1::text[])",
    [copies.map((c) => c.documentId)],
  )
  expect(changedTargets.rows[0].c).toBe(0)
}, 120_000)

it('成功写路径不会在无 Wiki 权威时仅更新投影', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'manual-pg', password: 'Knowledge123!', name: '投影守门' })
  const siteId = await createReadySite(owner.accessToken, '守门站')
  const docsPath = `/api/sites/${siteId}/knowledge-base/documents`
  const created = await requestJson(app, 'POST', docsPath, {
    token: owner.accessToken,
    body: { title: '守门资料', content: '权威正文' },
  })
  expect(created.status).toBe(201)
  const documentId = String((created.body.document as Record<string, unknown>).documentId)
  const kb = (await database.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1', [siteId])).rows[0]
  await database.query('UPDATE knowledge_documents SET content=$1 WHERE doc_id=$2 AND kb_id=$3', ['仅投影', documentId, kb.kb_id])
  const listPoisoned = await requestJson(app, 'GET', docsPath, { token: owner.accessToken })
  const poisoned = (listPoisoned.body.documents as Array<Record<string, unknown>>).find((d) => d.documentId === documentId)
  expect(poisoned?.content).toBe('仅投影')

  const rebuilt = await requestJson(app, 'PUT', `${docsPath}/${documentId}`, {
    token: owner.accessToken,
    body: { title: '守门资料', content: '权威正文' },
  })
  expect(rebuilt.status).toBe(200)
  const pg = (await database.query('SELECT content FROM knowledge_documents WHERE doc_id=$1', [documentId])).rows[0]
  expect(pg.content).toBe('权威正文')
  expect(await readKnowledgeFile(siteId, manualRawPath(documentId))).toContain('权威正文')
}, 120_000)
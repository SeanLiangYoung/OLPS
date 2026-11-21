import { afterAll, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

const database = createTestPool()
afterAll(async () => { await database.end() })

it('每站独立知识资料、成员权限与跨站复制保持独立正文', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'knowledge-owner', password: 'Knowledge123!', name: '资料管理员' })
  const member = await registerUser(app, { account: 'knowledge-member', password: 'Knowledge123!', name: '资料成员' })
  const invalidSite = await requestJson(app, 'POST', '/api/sites', { token: owner.accessToken, body: { name: '' } })
  expect(invalidSite.status).toBe(400)
  expect(invalidSite.body.code).toBe('VALIDATION_FAILED')
  expect(invalidSite.body.details).toBeInstanceOf(Array)
  const sites: string[] = []
  for (const name of ['网站甲', '网站乙']) {
    const created = await requestJson(app, 'POST', '/api/sites', { token: owner.accessToken, body: { name } })
    expect(created.status).toBe(201)
    const siteId = String((created.body.site as Record<string, unknown>).siteId)
    sites.push(siteId)
    await expect.poll(async () => {
      const result = await requestJson(app, 'GET', `/api/sites/${siteId}/initialization`, { token: owner.accessToken })
      if (result.body.initStatus === 'failed') throw new Error(String(result.body.error))
      return result.body.initStatus
    }, { timeout: 30000 }).toBe('ready')
  }
  const source = `/api/sites/${sites[0]}/knowledge-base/documents`
  const target = `/api/sites/${sites[1]}/knowledge-base/documents`
  const inaccessibleRetry = await requestJson(app, 'POST', `/api/sites/${sites[0]}/initialization/retry`, { token: member.accessToken })
  expect(inaccessibleRetry.status).toBe(404)
  expect(inaccessibleRetry.body.code).toBe('NOT_FOUND')
  const invalidDocument = await requestJson(app, 'POST', source, { token: owner.accessToken, body: { title: '', content: '' } })
  expect(invalidDocument.status).toBe(400)
  expect(invalidDocument.body.details).toBeInstanceOf(Array)
  expect((await requestJson(app, 'GET', source, { token: member.accessToken })).status).toBe(404)
  const created = await requestJson(app, 'POST', source, { token: owner.accessToken, body: { title: '产品资料', content: '产品原始说明' } })
  expect(created.status).toBe(201)
  const documentId = String((created.body.document as Record<string, unknown>).documentId)
  expect((await requestJson(app, 'POST', `/api/sites/${sites[0]}/owners`, { token: owner.accessToken, body: { account: 'knowledge-member' } })).status).toBe(200)
  expect((await requestJson(app, 'GET', source, { token: member.accessToken })).body.documents).toHaveLength(1)
  expect((await requestJson(app, 'POST', `${source}/${documentId}/copy`, { token: member.accessToken, body: { targetSiteIds: [sites[1]] } })).status).toBe(403)
  expect((await requestJson(app, 'GET', target, { token: owner.accessToken })).body.documents).toEqual([])
  const copied = await requestJson(app, 'POST', `${source}/${documentId}/copy`, { token: owner.accessToken, body: { targetSiteIds: [sites[1]] } })
  expect(copied.status).toBe(201)
  const targetDocuments = (await requestJson(app, 'GET', target, { token: owner.accessToken })).body.documents as Array<Record<string, unknown>>
  expect(targetDocuments).toHaveLength(1)
  expect(targetDocuments[0].documentId).not.toBe(documentId)
  expect(targetDocuments[0].content).toBe('产品原始说明')
  expect((await requestJson(app, 'PUT', `${source}/${documentId}`, { token: member.accessToken, body: { title: '更新资料', content: '产品更新说明' } })).status).toBe(200)
  expect(((await requestJson(app, 'GET', target, { token: owner.accessToken })).body.documents as Array<Record<string, unknown>>)[0].content).toBe('产品原始说明')
  expect((await requestJson(app, 'DELETE', `${source}/${documentId}`, { token: owner.accessToken })).status).toBe(204)
  expect((await requestJson(app, 'GET', `${source}/${documentId}`, { token: owner.accessToken })).status).toBe(404)
  expect((await requestJson(app, 'GET', target, { token: owner.accessToken })).body.documents).toHaveLength(1)
  const knowledge = await database.query('SELECT site_id,count(*) FROM knowledge_bases GROUP BY site_id')
  expect(knowledge.rows).toHaveLength(2)
  expect(knowledge.rows.every(row => row.count === '1')).toBe(true)
}, 60000)

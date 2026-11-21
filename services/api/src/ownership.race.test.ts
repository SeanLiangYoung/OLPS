import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { queryDraftOwnerAccounts, queryDraftOwnerUserIds, querySiteOwnerAccounts, querySiteOwnerUserIds, runWhileBlockingDraftOwnerRemoval, runWhileBlockingSiteOwnerRemoval } from './test-support/owner-race-coordination.js'

const database = createTestPool()
afterAll(async () => { await database.end() })
beforeEach(resetTestDatabase)

async function fixture(scope: 'site' | 'draft') {
  const a = await registerUser(app, { account: 'member-a', password: 'Members123!', name: '成员甲' })
  const b = await registerUser(app, { account: 'member-b', password: 'Members123!', name: '成员乙' })
  const c = await registerUser(app, { account: 'member-c', password: 'Members123!', name: '成员丙' })
  expect([a.status, b.status, c.status]).toEqual([201, 201, 201])
  const created = await requestJson(app, 'POST', '/api/sites', { token: a.accessToken, body: { name: '成员协作网站' } })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  const draftId = String((created.body.draft as Record<string, unknown>).draftId)
  await expect.poll(async () => {
    const result = await requestJson(app, 'GET', `/api/sites/${siteId}/initialization`, { token: a.accessToken })
    if (result.body.initStatus === 'failed') throw new Error(String(result.body.error))
    return result.body.initStatus
  }, { timeout: 30000 }).toBe('ready')
  const resourceId = scope === 'site' ? siteId : draftId
  const prefix = scope === 'site' ? `/api/sites/${resourceId}/owners` : `/api/drafts/${resourceId}/owners`
  return { a, b, c, resourceId, siteId, draftId, prefix }
}

for (const scope of ['site', 'draft'] as const) {
  describe(`${scope} 成员修改并发`, () => {
    const accounts = scope === 'site' ? querySiteOwnerAccounts : queryDraftOwnerAccounts
    const userIds = scope === 'site' ? querySiteOwnerUserIds : queryDraftOwnerUserIds
    const blockedRemoval = scope === 'site' ? runWhileBlockingSiteOwnerRemoval : runWhileBlockingDraftOwnerRemoval

    it('等待资源锁期间撤销操作者权限，拒绝修改且保留目标成员', async () => {
      const { a, b, resourceId, prefix } = await fixture(scope)
      for (const account of ['member-b', 'member-c']) expect((await requestJson(app, 'POST', prefix, { token: a.accessToken, body: { account } })).status).toBe(200)
      const result = await blockedRemoval(database, resourceId, String(a.user.userId), () => requestJson(app, 'DELETE', `${prefix}/${b.user.userId}`, { token: a.accessToken }))
      expect(result.status).toBe(403)
      expect(await userIds(database, resourceId)).toContain(String(b.user.userId))
      expect(await userIds(database, resourceId)).not.toContain(String(a.user.userId))
    })

    it('并发添加和删除保持响应与数据库成员一致', async () => {
      const { a, b, resourceId, prefix } = await fixture(scope)
      expect((await requestJson(app, 'POST', prefix, { token: a.accessToken, body: { account: 'member-b' } })).status).toBe(200)
      const [removed, added] = await Promise.all([
        requestJson(app, 'DELETE', `${prefix}/${b.user.userId}`, { token: a.accessToken }),
        requestJson(app, 'POST', prefix, { token: a.accessToken, body: { account: 'member-c' } }),
      ])
      expect(removed.status).toBe(200); expect(added.status).toBe(200)
      expect((await accounts(database, resourceId)).sort()).toEqual(['member-a', 'member-c'])
    })

    it('双方并发删除成员后保留至少一名成员', async () => {
      const { a, b, resourceId, prefix } = await fixture(scope)
      expect((await requestJson(app, 'POST', prefix, { token: a.accessToken, body: { account: 'member-b' } })).status).toBe(200)
      const results = await Promise.all([
        requestJson(app, 'DELETE', `${prefix}/${b.user.userId}`, { token: a.accessToken }),
        requestJson(app, 'DELETE', `${prefix}/${a.user.userId}`, { token: b.accessToken }),
      ])
      expect(results.map(result => result.status).sort()).toEqual([200, 403])
      expect(await accounts(database, resourceId)).toHaveLength(1)
    })
  })
}

it('撤销网站权限后无法读取网站、重新授权或读取已有询盘', async () => {
  const { a, b, siteId, draftId, prefix } = await fixture('site')
  for (const path of [prefix, `/api/drafts/${draftId}/owners`]) expect((await requestJson(app, 'POST', path, { token: a.accessToken, body: { account: 'member-b' } })).status).toBe(200)
  const pages = await requestJson(app, 'GET', `/api/drafts/${draftId}/pages?locale=en`, { token: a.accessToken })
  const contact = (pages.body.pages as Array<{ meta: { pageId: string; role: string }; locale: { blocks: Array<{ id: string; type: string }> } }>).find(page => page.meta.role === 'contact')!
  const preview = await requestJson(app, 'POST', `/api/drafts/${draftId}/preview`, { token: a.accessToken, body: { locale: 'en', returnPath: '/inquiries' } })
  expect(preview.status).toBe(200)
  const capability = String(preview.body.previewUrl).split('/')[2]
  const submitted = await requestJson(app, 'POST', `/api/preview-access/${capability}/inquiries`, { body: { target: { ref: 'page', id: contact.meta.pageId }, locale: 'en', formId: contact.locale.blocks.find(block => block.type === 'plugin/inquiry-form/form')!.id, fields: { name: '访客', email: 'visitor@example.com', message: '权限撤销测试' }, privacyConsent: true, attribution: {}, eventId: crypto.randomUUID() } })
  expect(submitted.status).toBe(201)
  const history = await requestJson(app, 'GET', `/api/sites/${siteId}/inquiries?source=preview`, { token: b.accessToken })
  expect(history.status).toBe(200); expect(history.body.inquiries).toHaveLength(1)
  expect((await requestJson(app, 'DELETE', `${prefix}/${b.user.userId}`, { token: a.accessToken })).status).toBe(200)
  expect((await requestJson(app, 'GET', `/api/sites/${siteId}`, { token: b.accessToken })).status).toBe(404)
  expect((await requestJson(app, 'GET', '/api/sites', { token: b.accessToken })).body.sites).toEqual([])
  expect((await requestJson(app, 'POST', prefix, { token: b.accessToken, body: { account: 'member-b' } })).status).toBe(403)
  expect((await requestJson(app, 'GET', `/api/sites/${siteId}/inquiries?source=preview`, { token: b.accessToken })).status).toBe(403)
  expect((await requestJson(app, 'POST', `/api/sites/${siteId}/publish`, { token: b.accessToken, body: { draftId, requestKey: crypto.randomUUID() } })).status).toBe(403)
}, 60000)

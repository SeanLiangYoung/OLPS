import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { columnExists } from './test-support/schema.js'
import { registerUser, requestJson } from './test-support/http.js'

describe('公开询盘与事件', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function publishedSiteId(): Promise<string> {
    const reg = await registerUser(app, {
      account: 'public-site-owner',
      password: 'public-pass',
      name: 'Public Owner',
    })
    expect(reg.status).toBe(201)
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: reg.accessToken,
      body: { name: 'Public Site' },
    })
    expect(draft.status).toBe(201)
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const push = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, {
      token: reg.accessToken,
    })
    expect(push.status).toBe(200)
    return String((push.body.site as Record<string, unknown>).siteId)
  }

  it('公开询盘路径不含 tenant 标识', async () => {
    const siteId = await publishedSiteId()
    const res = await requestJson(app, 'POST', `/api/public/${siteId}/inquiries`, {
      body: { email: 'a@example.com', message: 'hello' },
    })
    expect(res.status).toBe(201)
    expect(res.body.inquiryId).toBeTruthy()
  })

  it('公开事件路径不含 tenant 标识', async () => {
    const siteId = await publishedSiteId()
    const res = await requestJson(app, 'POST', `/api/public/${siteId}/events`, {
      body: { name: 'page_view', payload: { path: '/' } },
    })
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
  })

  it('旧 tenant 路径不再可用', async () => {
    const res = await app.request('/api/public/tenant-old/site-old/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com' }),
    })
    expect(res.status).toBe(404)
  })

  it('询盘写入数据库仅关联 site_id', async () => {
    const siteId = await publishedSiteId()
    await requestJson(app, 'POST', `/api/public/${siteId}/inquiries`, {
      body: { email: 'db@example.com' },
    })
    const row = await pool.query(`SELECT site_id FROM inquiries WHERE site_id=$1 LIMIT 1`, [siteId])
    expect(row.rowCount).toBe(1)
    expect(String(row.rows[0]!.site_id)).toBe(siteId)
    expect(await columnExists(pool, 'inquiries', 'tenant_id')).toBe(false)
  })
})

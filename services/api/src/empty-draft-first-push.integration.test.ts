import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

describe('空草稿首次发布（真实远端 HTTP）', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    requireRemoteServiceConfig()
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function tokenFor(account: string): Promise<string> {
    const reg = await registerUser(app, {
      account,
      password: 'empty-first-push',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it('无页面草稿首次 push 写入 sites 且 publicUrl 返回 HTTP 200', async () => {
    const token = await tokenFor('empty-first-push-user')
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Empty First Publish' },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    const before = await pool.query(`SELECT COUNT(*)::int AS c FROM sites`)
    expect(Number(before.rows[0]!.c)).toBe(0)

    const push = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(push.status).toBe(200)
    const site = push.body.site as Record<string, unknown>
    expect(site.siteId).toBeTruthy()
    expect(site.publicUrl).toBeTruthy()

    const after = await pool.query(`SELECT COUNT(*)::int AS c FROM sites`)
    expect(Number(after.rows[0]!.c)).toBe(1)

    const publicUrl = String(site.publicUrl).replace(/\/+$/, '')
    const httpRes = await fetch(`${publicUrl}/`)
    expect(httpRes.status).toBe(200)
  })
})

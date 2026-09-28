import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

describe('pull push 本地规则（不启动远端）', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function registerAndToken(account: string): Promise<string> {
    const reg = await registerUser(app, {
      account,
      password: 'sync-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it('尚未发布且无 siteId 的草稿执行 pull 返回 409', async () => {
    const token = await registerAndToken('pull-no-remote')
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Unpublished Draft' },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    const pull = await requestJson(app, 'POST', `/api/drafts/${draftId}/pull`, { token })
    expect(pull.status).toBe(409)
    expect(String(pull.body.error)).toMatch(/远端|来源|未发布|site/)
  })

  it('push 请求体携带 remoteSiteId 时 API 拒绝（客户端不得自定）', async () => {
    const token = await registerAndToken('no-client-remote-id')
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Push Draft' },
    })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    const push = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, {
      token,
      body: { remoteSiteId: '../escape' },
    })
    expect(push.status).toBe(400)
    expect(String(push.body.error)).toMatch(/remoteSiteId|不允许|客户端/)
  })

})

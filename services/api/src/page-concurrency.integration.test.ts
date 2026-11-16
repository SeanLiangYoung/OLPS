import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

describe('共享草稿页面并发编辑', () => {
  const pool = createTestPool()
  beforeEach(resetTestDatabase)
  afterAll(() => pool.end())

  it('过期页面保存及删除返回 409 并保留其他所有者的修改', async () => {
    const owner = await registerUser(app, { account: 'concurrent-a', password: 'concurrent-pass', name: 'A' })
    const other = await registerUser(app, { account: 'concurrent-b', password: 'concurrent-pass', name: 'B' })
    const call = (token: string, method: string, url: string, body?: unknown) => requestJson(app, method, url, { token, body })
    const created = await call(owner.accessToken, 'POST', '/api/drafts', { name: 'Shared' })
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)
    expect((await call(owner.accessToken, 'POST', `/api/drafts/${draftId}/owners`, { account: 'concurrent-b' })).status).toBe(200)
    const page = await call(owner.accessToken, 'POST', `/api/drafts/${draftId}/pages`, { kind: 'content', title: 'Original', slug: 'article' })
    const original = page.body.page as Record<string, unknown>
    const url = `/api/drafts/${draftId}/pages/${original.pageId}`
    const saved = await call(other.accessToken, 'PATCH', url, { expectedUpdatedAt: original.updatedAt, title: 'Updated by B' })
    expect(saved.status).toBe(200)
    expect((await call(owner.accessToken, 'PATCH', url, { expectedUpdatedAt: original.updatedAt, title: 'Outdated A' })).status).toBe(409)
    expect((await call(owner.accessToken, 'DELETE', url, { expectedUpdatedAt: original.updatedAt })).status).toBe(409)
    const current = await call(owner.accessToken, 'GET', url)
    expect((current.body.page as Record<string, unknown>).title).toBe('Updated by B')
    expect((await call(owner.accessToken, 'PATCH', url, { expectedUpdatedAt: (current.body.page as Record<string, unknown>).updatedAt, title: 'Updated by A' })).status).toBe(200)
  })
})

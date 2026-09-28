import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

describe('网站与草稿所有权', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function authToken(account: string): Promise<string> {
    const reg = await registerUser(app, {
      account,
      password: 'owner-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it('未发布前 GET /api/sites 为空列表', async () => {
    const token = await authToken('site-empty')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'My Draft' },
    })
    expect(draft.status).toBe(201)
    const sites = await requestJson(app, 'GET', '/api/sites', { token })
    expect(sites.status).toBe(200)
    expect(sites.body.sites).toEqual([])
  })

  it('非所有者无法读取他人草稿', async () => {
    const tokenA = await authToken('owner-a')
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Private Draft' },
    })
    expect(created.status).toBe(201)
    const draft = created.body.draft as Record<string, unknown>
    const draftId = String(draft.draftId)

    const tokenB = await authToken('owner-b')
    const peek = await requestJson(app, 'GET', `/api/drafts/${draftId}`, {
      token: tokenB,
    })
    expect(peek.status).toBe(403)
  })

  it('草稿所有者可以添加其他用户并列出', async () => {
    const tokenA = await authToken('draft-owner')
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Shared Draft' },
    })
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    await registerUser(app, {
      account: 'collaborator',
      password: 'collab-pass',
      name: 'Collaborator',
    })

    const add = await requestJson(app, 'POST', `/api/drafts/${draftId}/owners`, {
      token: tokenA,
      body: { account: 'collaborator' },
    })
    expect(add.status).toBe(200)

    const owners = await requestJson(app, 'GET', `/api/drafts/${draftId}/owners`, {
      token: tokenA,
    })
    expect(owners.status).toBe(200)
    const users = owners.body.users as Array<Record<string, unknown>>
    expect(users.some((u) => u.account === 'collaborator')).toBe(true)
  })

  it('不能移除草稿的最后一名所有者', async () => {
    const token = await authToken('last-owner')
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Solo Draft' },
    })
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)
    const me = await requestJson(app, 'GET', '/api/auth/me', { token })
    const userId = String((me.body.user as Record<string, unknown>).userId)

    const removed = await requestJson(
      app,
      'DELETE',
      `/api/drafts/${draftId}/owners/${userId}`,
      { token },
    )
    expect(removed.status).toBe(409)
  })

  it('撤销网站所有权后 B 自己的关联草稿不得再向远端发布', async () => {
    const tokenA = await authToken('revoke-a')
    const tokenB = await authToken('revoke-b')

    const draftA = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Publish Draft' },
    })
    expect(draftA.status).toBe(201)
    const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)

    const pushOk = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(pushOk.status).toBe(200)
    const siteId = String((pushOk.body.site as Record<string, unknown>).siteId)

    const addOwner = await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'revoke-b' },
    })
    expect(addOwner.status).toBe(200)

    const draftB = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenB,
      body: { name: 'B fork', siteId },
    })
    expect(draftB.status).toBe(201)
    const draftBId = String((draftB.body.draft as Record<string, unknown>).draftId)

    const pushB = await requestJson(app, 'POST', `/api/drafts/${draftBId}/push`, { token: tokenB })
    expect(pushB.status).toBe(200)

    const meB = await requestJson(app, 'GET', '/api/auth/me', { token: tokenB })
    const userIdB = String((meB.body.user as Record<string, unknown>).userId)

    const revoke = await requestJson(
      app,
      'DELETE',
      `/api/sites/${siteId}/owners/${userIdB}`,
      { token: tokenA },
    )
    expect(revoke.status).toBe(200)

    const pushDenied = await requestJson(app, 'POST', `/api/drafts/${draftBId}/push`, {
      token: tokenB,
    })
    expect(pushDenied.status).toBe(403)
  })
})

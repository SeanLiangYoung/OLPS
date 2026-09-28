import fs from 'node:fs'
import path from 'node:path'
import { SITE_PATHS } from '@olps/sync'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

describe('pull push 与真实远端 HTTP 及 Git 冲突', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    requireRemoteServiceConfig()
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function token(account: string, name: string): Promise<string> {
    const reg = await registerUser(app, {
      account,
      password: 'remote-pass',
      name,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it(
    'A push 发布后 B 基于网站创建草稿，双方修改同一页面产生真实冲突并可 continue',
    async () => {
    const tokenA = await token('sync-a', 'User A')
    const tokenB = await token('sync-b', 'User B')

    const draftA = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Site from A' },
    })
    expect(draftA.status).toBe(201)
    const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)

    const pageA = await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
      token: tokenA,
      body: { kind: 'content', title: 'Shared', slug: 'shared' },
    })
    expect(pageA.status).toBe(201)
    const pageIdA = String((pageA.body.page as Record<string, unknown>).pageId)

    const pushA = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(pushA.status).toBe(200)
    const siteId = String((pushA.body.site as Record<string, unknown>).siteId)
    expect((pushA.body.site as Record<string, unknown>).remoteSiteId).toBeTruthy()

    const addOwner = await requestJson(app, 'POST', `/api/sites/${siteId}/owners`, {
      token: tokenA,
      body: { account: 'sync-b' },
    })
    expect(addOwner.status).toBe(200)

    const draftB = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenB,
      body: { name: 'B fork', siteId },
    })
    expect(draftB.status).toBe(201)
    const draftBId = String((draftB.body.draft as Record<string, unknown>).draftId)

    const pullInit = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pull`, { token: tokenB })
    expect(pullInit.status).toBe(200)

    const pagesB0 = await requestJson(app, 'GET', `/api/drafts/${draftBId}/pages`, { token: tokenB })
    const pageIdB = String(
      (pagesB0.body.pages as Array<Record<string, unknown>>).find((p) => p.slug === 'shared')!.pageId,
    )

    await requestJson(app, 'PATCH', `/api/drafts/${draftAId}/pages/${pageIdA}`, {
      token: tokenA,
      body: { title: 'Title from A' },
    })
    const pushA2 = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(pushA2.status).toBe(200)

    expect(pageIdB).toBe(pageIdA)
    await requestJson(app, 'PATCH', `/api/drafts/${draftBId}/pages/${pageIdB}`, {
      token: tokenB,
      body: { title: 'Title from B' },
    })

    const pullB = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pull`, { token: tokenB })
    expect(pullB.status).toBe(409)
    expect((pullB.body.draft as Record<string, unknown>).status).toBe('conflict')

    const cont = await requestJson(app, 'POST', `/api/drafts/${draftBId}/continue`, {
      token: tokenB,
      body: { userMessage: '保留双方对标题的修改' },
    })
    expect(cont.status).toBe(200)

    const pageAfter = await requestJson(app, 'GET', `/api/drafts/${draftBId}/pages/${pageIdB}`, {
      token: tokenB,
    })
    expect(pageAfter.status).toBe(200)
    const title = String((pageAfter.body.page as Record<string, unknown>).title)
    expect(title).toContain('A')
    expect(title).toContain('B')
  },
    1_200_000,
  )

  it('pull 合并后 GET 页面读取 sandbox 真源而非过期数据库索引', async () => {
    const tokenA = await token('merge-a', 'Merge A')
    const draftA = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Merge Site' },
    })
    const draftAId = String((draftA.body.draft as Record<string, unknown>).draftId)
    await requestJson(app, 'POST', `/api/drafts/${draftAId}/pages`, {
      token: tokenA,
      body: { kind: 'content', title: 'V1', slug: 'merge-page' },
    })
    const push = await requestJson(app, 'POST', `/api/drafts/${draftAId}/push`, { token: tokenA })
    expect(push.status).toBe(200)
    const siteId = String((push.body.site as Record<string, unknown>).siteId)

    const draftB = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Merge fork', siteId },
    })
    const draftBId = String((draftB.body.draft as Record<string, unknown>).draftId)
    const pull = await requestJson(app, 'POST', `/api/drafts/${draftBId}/pull`, { token: tokenA })
    expect(pull.status).toBe(200)

    const pages = await requestJson(app, 'GET', `/api/drafts/${draftBId}/pages`, { token: tokenA })
    const list = pages.body.pages as Array<Record<string, unknown>>
    const row = list.find((p) => p.slug === 'merge-page')
    expect(row?.title).toBe('V1')

    const sandboxId = String((pull.body.draft as Record<string, unknown>).sandboxId)
    const sandboxRoot = process.env.SANDBOX_ROOT ?? ''
    const pageDir = path.join(sandboxRoot, sandboxId, SITE_PATHS.pagesDir)
    expect(fs.existsSync(pageDir)).toBe(true)
  })
})

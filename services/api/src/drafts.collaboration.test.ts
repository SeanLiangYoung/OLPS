import fs from 'node:fs'
import path from 'node:path'
import { SITE_PATHS } from '@olps/sync'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

describe('草稿与页面编辑', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function tokenFor(account: string): Promise<string> {
    const reg = await registerUser(app, {
      account,
      password: 'draft-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it('POST /api/drafts 创建独立草稿并返回 draft 字段', async () => {
    const token = await tokenFor('draft-create')
    const res = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'New Site Idea' },
    })
    expect(res.status).toBe(201)
    const draft = res.body.draft as Record<string, unknown>
    expect(draft.draftId).toBeTruthy()
    expect(draft.name).toBe('New Site Idea')
    expect(draft.siteId).toBeNull()
    expect(draft.sandboxId).toBeTruthy()
  })

  it('创建草稿时在 sandbox 目录初始化 Git 仓库', async () => {
    const token = await tokenFor('draft-git')
    const res = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Git Draft' },
    })
    expect(res.status).toBe(201)
    const sandboxId = String((res.body.draft as Record<string, unknown>).sandboxId)
    const root = process.env.SANDBOX_ROOT ?? ''
    const gitDir = path.join(root, sandboxId, '.git')
    expect(fs.existsSync(gitDir)).toBe(true)
  })

  it('PATCH /api/drafts/:draftId/settings 写入 sandbox 真源', async () => {
    const token = await tokenFor('draft-settings')
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Settings Draft' },
    })
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)
    const patch = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/settings`, {
      token,
      body: { defaultLocale: 'zh-CN', analyticsEnabled: true },
    })
    expect(patch.status).toBe(200)
    const draft = patch.body.draft as Record<string, unknown>
    const settings = draft.settings as Record<string, unknown>
    expect(settings.defaultLocale).toBe('zh-CN')
    expect(settings.analyticsEnabled).toBe(true)

    const sandboxId = String(draft.sandboxId)
    const settingsPath = path.join(process.env.SANDBOX_ROOT ?? '', sandboxId, SITE_PATHS.siteSettings)
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    expect(raw.defaultLocale).toBe('zh-CN')
    expect(raw.analyticsEnabled).toBe(true)
  })

  it('草稿页面 POST 与 GET 使用 /api/drafts/:draftId/pages', async () => {
    const token = await tokenFor('draft-pages')
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Pages Draft' },
    })
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    const pageCreate = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token,
      body: { kind: 'content', title: 'Hello', slug: 'hello' },
    })
    expect(pageCreate.status).toBe(201)
    const pageId = String((pageCreate.body.page as Record<string, unknown>).pageId)

    const list = await requestJson(app, 'GET', `/api/drafts/${draftId}/pages`, { token })
    expect(list.status).toBe(200)
    const pages = list.body.pages as Array<Record<string, unknown>>
    expect(pages.some((p) => p.pageId === pageId)).toBe(true)

    const getOne = await requestJson(app, 'GET', `/api/drafts/${draftId}/pages/${pageId}`, { token })
    expect(getOne.status).toBe(200)
    expect((getOne.body.page as Record<string, unknown>).draftId).toBe(draftId)
  })

  it('PATCH /api/drafts/:draftId/pages/:pageId 修改写入 sandbox 文件', async () => {
    const token = await tokenFor('page-patch')
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'Patch Draft' },
    })
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)
    const pageCreate = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token,
      body: { kind: 'content', title: 'Old', slug: 'old' },
    })
    const pageId = String((pageCreate.body.page as Record<string, unknown>).pageId)

    const patched = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token,
      body: { title: 'New Title' },
    })
    expect(patched.status).toBe(200)
    expect((patched.body.page as Record<string, unknown>).title).toBe('New Title')
  })

  it('同站两个草稿共享 pageId 且各自 sandbox 内容独立，他人不可读写', async () => {
    const tokenA = await tokenFor('dual-owner')
    const draft1 = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Primary' },
    })
    const draft1Id = String((draft1.body.draft as Record<string, unknown>).draftId)
    const pageCreate = await requestJson(app, 'POST', `/api/drafts/${draft1Id}/pages`, {
      token: tokenA,
      body: { kind: 'content', title: 'Shared Page', slug: 'shared-page' },
    })
    const sharedPageId = String((pageCreate.body.page as Record<string, unknown>).pageId)
    const push = await requestJson(app, 'POST', `/api/drafts/${draft1Id}/push`, { token: tokenA })
    expect(push.status).toBe(200)
    const siteId = String((push.body.site as Record<string, unknown>).siteId)

    const draft2 = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenA,
      body: { name: 'Fork', siteId },
    })
    const draft2Id = String((draft2.body.draft as Record<string, unknown>).draftId)
    await requestJson(app, 'POST', `/api/drafts/${draft2Id}/pull`, { token: tokenA })

    const list2 = await requestJson(app, 'GET', `/api/drafts/${draft2Id}/pages`, { token: tokenA })
    const forkPage = (list2.body.pages as Array<Record<string, unknown>>).find(
      (p) => p.slug === 'shared-page',
    )
    expect(forkPage?.pageId).toBe(sharedPageId)

    await requestJson(app, 'PATCH', `/api/drafts/${draft1Id}/pages/${sharedPageId}`, {
      token: tokenA,
      body: { title: 'Draft One Title' },
    })
    await requestJson(app, 'PATCH', `/api/drafts/${draft2Id}/pages/${sharedPageId}`, {
      token: tokenA,
      body: { title: 'Draft Two Title' },
    })

    const read1 = await requestJson(app, 'GET', `/api/drafts/${draft1Id}/pages/${sharedPageId}`, {
      token: tokenA,
    })
    const read2 = await requestJson(app, 'GET', `/api/drafts/${draft2Id}/pages/${sharedPageId}`, {
      token: tokenA,
    })
    expect((read1.body.page as Record<string, unknown>).title).toBe('Draft One Title')
    expect((read2.body.page as Record<string, unknown>).title).toBe('Draft Two Title')

    const stranger = await registerUser(app, {
      account: 'dual-stranger',
      password: 'draft-pass',
      name: 'Stranger',
    })
    expect(stranger.status).toBe(201)
    const denied = await requestJson(
      app,
      'GET',
      `/api/drafts/${draft1Id}/pages/${sharedPageId}`,
      { token: stranger.accessToken },
    )
    expect(denied.status).toBe(403)
  })

  it('首次 push 成功后才写入 sites 表', async () => {
    const token = await tokenFor('first-push')
    const created = await requestJson(app, 'POST', '/api/drafts', {
      token,
      body: { name: 'First Publish' },
    })
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)

    const before = await pool.query(`SELECT COUNT(*)::int AS c FROM sites`)
    expect(Number(before.rows[0]!.c)).toBe(0)

    const push = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token })
    expect(push.status).toBe(200)

    const after = await pool.query(`SELECT COUNT(*)::int AS c FROM sites`)
    expect(Number(after.rows[0]!.c)).toBe(1)
  })

})

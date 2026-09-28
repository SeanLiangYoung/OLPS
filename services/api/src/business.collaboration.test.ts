import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

describe('业务模块草稿与网站权限', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function setupDraft(account: string): Promise<{ token: string; draftId: string }> {
    const reg = await registerUser(app, {
      account,
      password: 'biz-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: reg.accessToken,
      body: { name: 'Biz Draft' },
    })
    expect(draft.status).toBe(201)
    return {
      token: reg.accessToken,
      draftId: String((draft.body.draft as Record<string, unknown>).draftId),
    }
  }

  it('generate_page 任务必须绑定 draftId 且非所有者不可用', async () => {
    const owner = await setupDraft('job-owner')
    const stranger = await registerUser(app, {
      account: 'job-stranger',
      password: 'biz-pass',
      name: 'Stranger',
    })
    expect(stranger.status).toBe(201)

    const kb = await requestJson(app, 'POST', '/api/knowledge-bases', {
      token: owner.token,
      body: { name: 'Job KB' },
    })
    const kbId = String((kb.body.knowledgeBase as Record<string, unknown>).kbId)

    const denied = await requestJson(app, 'POST', '/api/jobs/generate_page', {
      token: stranger.accessToken,
      body: {
        draftId: owner.draftId,
        knowledgeBaseId: kbId,
        kind: 'content',
        title: 'Gen',
        slug: 'gen',
      },
    })
    expect(denied.status).toBe(403)

    const ok = await requestJson(app, 'POST', '/api/jobs/generate_page', {
      token: owner.token,
      body: {
        draftId: owner.draftId,
        knowledgeBaseId: kbId,
        kind: 'content',
        title: 'Gen',
        slug: 'gen',
      },
    })
    expect(ok.status).toBe(201)
    expect((ok.body.job as Record<string, unknown>).status).toBe('completed')
  })

  it('站点集成配置仅网站所有者可修改', async () => {
    const owner = await setupDraft('int-owner')
    const push = await requestJson(app, 'POST', `/api/drafts/${owner.draftId}/push`, {
      token: owner.token,
    })
    expect(push.status).toBe(200)
    const siteId = String((push.body.site as Record<string, unknown>).siteId)

    const stranger = await registerUser(app, {
      account: 'int-stranger',
      password: 'biz-pass',
      name: 'Stranger',
    })

    const denied = await requestJson(app, 'PATCH', `/api/sites/${siteId}/integrations`, {
      token: stranger.accessToken,
      body: { adsConnected: true },
    })
    expect(denied.status).toBe(403)

    const ok = await requestJson(app, 'PATCH', `/api/sites/${siteId}/integrations`, {
      token: owner.token,
      body: { adsConnected: true },
    })
    expect(ok.status).toBe(200)
  })

  it('询盘列表按 siteId 且要求网站所有权', async () => {
    const owner = await setupDraft('inq-owner')
    const push = await requestJson(app, 'POST', `/api/drafts/${owner.draftId}/push`, {
      token: owner.token,
    })
    const siteId = String((push.body.site as Record<string, unknown>).siteId)

    await requestJson(app, 'POST', `/api/public/${siteId}/inquiries`, {
      body: { email: 'lead@example.com' },
    })

    const list = await requestJson(app, 'GET', `/api/sites/${siteId}/inquiries`, {
      token: owner.token,
    })
    expect(list.status).toBe(200)
    const inquiries = list.body.inquiries as Array<Record<string, unknown>>
    expect(inquiries.length).toBe(1)
  })

  it('报告生成使用 draftId 与 pageId', async () => {
    const owner = await setupDraft('report-owner')
    const page = await requestJson(app, 'POST', `/api/drafts/${owner.draftId}/pages`, {
      token: owner.token,
      body: { kind: 'content', title: 'Report Page', slug: 'report-page' },
    })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)

    const push = await requestJson(app, 'POST', `/api/drafts/${owner.draftId}/push`, {
      token: owner.token,
    })
    const siteId = String((push.body.site as Record<string, unknown>).siteId)

    const report = await requestJson(app, 'POST', '/api/reports', {
      token: owner.token,
      body: { siteId, draftId: owner.draftId, pageId },
    })
    expect(report.status).toBe(201)
    expect((report.body.report as Record<string, unknown>).pageId).toBe(pageId)
  })

  it('dashboard 统计基于当前用户草稿与已发布网站', async () => {
    const owner = await setupDraft('dash-owner')
    await requestJson(app, 'POST', `/api/drafts/${owner.draftId}/pages`, {
      token: owner.token,
      body: { kind: 'site', title: 'Home', slug: 'home' },
    })
    const dash = await requestJson(app, 'GET', '/api/dashboard', { token: owner.token })
    expect(dash.status).toBe(200)
    expect((dash.body.pagesByKind as Record<string, number>).site).toBeGreaterThan(0)
  })
})

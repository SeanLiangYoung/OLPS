import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

type ReportChecklistItem = {
  id: string
  label: string
  passed: boolean
  detail: string
}

describe('未发布草稿报告', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function setupOwnerDraft(account: string): Promise<{ token: string; draftId: string }> {
    const reg = await registerUser(app, {
      account,
      password: 'report-pass',
      name: account,
    })
    expect(reg.status).toBe(201)
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: reg.accessToken,
      body: { name: `${account} draft` },
    })
    expect(draft.status).toBe(201)
    return {
      token: reg.accessToken,
      draftId: String((draft.body.draft as Record<string, unknown>).draftId),
    }
  }

  async function contentPageWithChecklist(
    token: string,
    draftId: string,
  ): Promise<{ pageId: string }> {
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token,
      body: { kind: 'content', title: 'Report Page', slug: 'report-page' },
    })
    expect(page.status).toBe(201)
    const pageId = String((page.body.page as Record<string, unknown>).pageId)
    const patched = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token,
      body: {
        seo: { title: 'SEO Title', description: 'SEO Description' },
        body: {
          html: '<meta name="viewport" content="width=device-width"><h1>Title</h1><p>body</p>',
        },
      },
    })
    expect(patched.status).toBe(200)
    return { pageId }
  }

  function checklistById(
    items: ReportChecklistItem[],
  ): Record<string, ReportChecklistItem> {
    return Object.fromEntries(items.map((item) => [item.id, item]))
  }

  it('未发布草稿仅凭 draftId 与 pageId 创建报告且 siteId 为 null', async () => {
    const owner = await setupOwnerDraft('unpub-report-owner')
    const { pageId } = await contentPageWithChecklist(owner.token, owner.draftId)

    const created = await requestJson(app, 'POST', '/api/reports', {
      token: owner.token,
      body: { draftId: owner.draftId, pageId },
    })
    expect(created.status).toBe(201)
    const report = created.body.report as Record<string, unknown>
    expect(report.draftId).toBe(owner.draftId)
    expect(report.pageId).toBe(pageId)
    expect(report.siteId).toBeNull()
  })

  it('非草稿所有者不得创建未发布草稿报告', async () => {
    const owner = await setupOwnerDraft('unpub-report-protect')
    const { pageId } = await contentPageWithChecklist(owner.token, owner.draftId)
    const stranger = await registerUser(app, {
      account: 'unpub-report-stranger',
      password: 'report-pass',
      name: 'stranger',
    })
    expect(stranger.status).toBe(201)

    const denied = await requestJson(app, 'POST', '/api/reports', {
      token: stranger.accessToken,
      body: { draftId: owner.draftId, pageId },
    })
    expect(denied.status).toBe(403)
  })

  it('未发布草稿报告可列表访问且详情含完整 checklist 项', async () => {
    const owner = await setupOwnerDraft('unpub-report-list')
    const { pageId } = await contentPageWithChecklist(owner.token, owner.draftId)

    const created = await requestJson(app, 'POST', '/api/reports', {
      token: owner.token,
      body: { draftId: owner.draftId, pageId },
    })
    expect(created.status).toBe(201)
    const reportId = String((created.body.report as Record<string, unknown>).reportId)

    const list = await requestJson(app, 'GET', `/api/drafts/${owner.draftId}/reports`, {
      token: owner.token,
    })
    expect(list.status).toBe(200)
    const reports = list.body.reports as Array<Record<string, unknown>>
    expect(reports.some((row) => String(row.reportId) === reportId)).toBe(true)

    const byDraft = await requestJson(
      app,
      'GET',
      `/api/drafts/${owner.draftId}/reports/${reportId}`,
      { token: owner.token },
    )
    expect(byDraft.status).toBe(200)

    const byId = await requestJson(app, 'GET', `/api/reports/${reportId}`, {
      token: owner.token,
    })
    expect(byId.status).toBe(200)

    const checklist = (byDraft.body.report as Record<string, unknown>).checklist as ReportChecklistItem[]
    const map = checklistById(checklist)
    expect(map.viewport?.passed).toBe(true)
    expect(map.seo_title?.passed).toBe(true)
    expect(map.seo_description?.passed).toBe(true)
    expect(map.has_h1?.passed).toBe(true)
    expect(map.locale?.passed).toBe(true)
    expect(Number((byDraft.body.report as Record<string, unknown>).score)).toBeGreaterThan(0)
  })

  it('未发布草稿传入不匹配的 siteId 时拒绝创建', async () => {
    const owner = await setupOwnerDraft('unpub-report-site-mismatch')
    const { pageId } = await contentPageWithChecklist(owner.token, owner.draftId)
    const fakeSiteId = '00000000-0000-4000-8000-000000000099'

    const denied = await requestJson(app, 'POST', '/api/reports', {
      token: owner.token,
      body: { draftId: owner.draftId, pageId, siteId: fakeSiteId },
    })
    expect(denied.status).toBe(403)
  })
})

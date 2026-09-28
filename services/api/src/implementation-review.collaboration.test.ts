import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { appConfig } from './config.js'
import { pool } from './db.js'
import { persistDraftSyncState } from './draft-sync-state.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { createFullLegacyTenantSchema } from './test-support/legacy-schema.js'
import { migrateToCollaborationModel } from './migrate.js'

describe('API 实现审查（21 项）', () => {
  const testPool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await testPool.end()
  })

  async function token(account: string): Promise<string> {
    const reg = await registerUser(app, { account, password: 'review-pass', name: account })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  it('3 persistDraftSyncState 未传 pendingOperation 时保留原值', async () => {
    const draftId = 'draft-pending-op-test'
    const now = new Date().toISOString()
    await pool.query(
      `INSERT INTO site_drafts(
        draft_id, site_id, name, sandbox_id, status, init_status, sync_status,
        pending_operation, created_at, updated_at
      ) VALUES ($1,NULL,'t',$2,'active','ready','awaiting_user','pull',$3,$3)`,
      [draftId, draftId, now],
    )
    await persistDraftSyncState(draftId, { syncStatus: 'awaiting_user' })
    const row = await pool.query(`SELECT pending_operation FROM site_drafts WHERE draft_id=$1`, [
      draftId,
    ])
    expect(String(row.rows[0]!.pending_operation)).toBe('pull')
  })

  it('18 公开询盘 query pageId 写入数据库且须属于已发布网站', async () => {
    const t = await token('inq-page')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: t,
      body: { name: 'Inq Site' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: t,
      body: { kind: 'content', title: 'Lead', slug: 'lead' },
    })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)
    const push = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token: t })
    expect(push.status).toBe(200)
    const siteId = String((push.body.site as Record<string, unknown>).siteId)

    const bad = await requestJson(
      app,
      'POST',
      `/api/public/${siteId}/inquiries?pageId=not-a-real-page`,
      { body: { email: 'x@example.com' } },
    )
    expect(bad.status).toBe(400)

    const ok = await requestJson(
      app,
      'POST',
      `/api/public/${siteId}/inquiries?pageId=${encodeURIComponent(pageId)}`,
      { body: { email: 'ok@example.com' } },
    )
    expect(ok.status).toBe(201)
    const row = await pool.query(
      `SELECT page_id FROM inquiries WHERE site_id=$1 ORDER BY inquiry_id DESC LIMIT 1`,
      [siteId],
    )
    expect(String(row.rows[0]!.page_id)).toBe(pageId)
  })

  it('20 启用 adsConnected 时缺少 adsAccountId 返回 400', async () => {
    const t = await token('int-validate')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: t,
      body: { name: 'Int Site' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const push = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token: t })
    const siteId = String((push.body.site as Record<string, unknown>).siteId)
    const res = await requestJson(app, 'PATCH', `/api/sites/${siteId}/integrations`, {
      token: t,
      body: { adsConnected: true },
    })
    expect(res.status).toBe(400)
  })

  it('19 广告页报告缺少 CTA 询盘标记时不得满分', async () => {
    const t = await token('ads-report')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: t,
      body: { name: 'Ads Report' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: t,
      body: { kind: 'ads', title: 'Ads', slug: 'ads' },
    })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)
    const report = await requestJson(app, 'POST', '/api/reports', {
      token: t,
      body: { draftId, pageId },
    })
    expect(report.status).toBe(201)
    const score = Number((report.body.report as Record<string, unknown>).score)
    expect(score).toBeLessThan(100)
  })

  it('8 报告 siteId 与草稿关联网站不一致时拒绝创建', async () => {
    const t = await token('report-mismatch')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: t,
      body: { name: 'R1' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: t,
      body: { kind: 'content', title: 'P', slug: 'p' },
    })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)
    const push = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token: t })
    const siteId = String((push.body.site as Record<string, unknown>).siteId)
    const otherSiteId = '00000000-0000-4000-8000-000000000099'
    const report = await requestJson(app, 'POST', '/api/reports', {
      token: t,
      body: { siteId: otherSiteId, draftId, pageId },
    })
    expect(report.status).toBe(403)
    void siteId
  })

  it('16 预览 API 返回完整 HTML 且 GET /preview 可访问', async () => {
    const t = await token('preview-user')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: t,
      body: { name: 'Preview' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: t,
      body: { kind: 'content', title: 'Prev', slug: 'prev' },
    })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)
    await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token: t,
      body: { body: { html: '<h1>Preview Title</h1><p>body</p>' } },
    })
    const preview = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages/${pageId}/preview`, {
      token: t,
    })
    expect(preview.status).toBe(200)
    const previewUrl = String((preview.body as Record<string, unknown>).previewUrl)
    expect(previewUrl).toMatch(/^\/preview\//)
    const httpRes = await app.request(previewUrl)
    expect(httpRes.status).toBe(200)
    const html = await httpRes.text()
    expect(html).toContain('Preview Title')
  })

  it('12 生成任务失败时持久化 failed 与 error', async () => {
    const t = await token('job-fail')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: t,
      body: { name: 'Job Draft' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const res = await requestJson(app, 'POST', '/api/jobs/generate_page', {
      token: t,
      body: {
        draftId,
        knowledgeBaseId: 'missing-kb-id',
        kind: 'content',
        title: 'X',
        slug: 'x',
      },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    const jobs = await pool.query(
      `SELECT status, error FROM jobs WHERE draft_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [draftId],
    )
    expect(jobs.rowCount).toBe(1)
    expect(String(jobs.rows[0]!.status)).toBe('failed')
    expect(String(jobs.rows[0]!.error ?? '')).not.toBe('')
  })

  it('13 迁移缺少映射时旧表行数不变', async () => {
    await createFullLegacyTenantSchema(pool)
    const pagesBefore = await pool.query(`SELECT COUNT(*)::int AS c FROM pages`)
    const sitesBefore = await pool.query(`SELECT COUNT(*)::int AS c FROM sites`)
    await expect(migrateToCollaborationModel(pool)).rejects.toThrow()
    const pagesAfter = await pool.query(`SELECT COUNT(*)::int AS c FROM pages`)
    const sitesAfter = await pool.query(`SELECT COUNT(*)::int AS c FROM sites`)
    expect(Number(pagesAfter.rows[0]!.c)).toBe(Number(pagesBefore.rows[0]!.c))
    expect(Number(sitesAfter.rows[0]!.c)).toBe(Number(sitesBefore.rows[0]!.c))
  })

  it('14 resetTestDatabase 只删除本进程上一 schema', async () => {
    const firstSchema = process.env.PG_TEST_SCHEMA
    expect(firstSchema).toBeTruthy()
    await resetTestDatabase()
    const secondSchema = process.env.PG_TEST_SCHEMA
    expect(secondSchema).toBeTruthy()
    expect(secondSchema).not.toBe(firstSchema)
    const adminUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL!
    const pg = await import('pg')
    const admin = new pg.default.Pool({ connectionString: adminUrl })
    try {
      const firstExists = await admin.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name=$1`,
        [firstSchema],
      )
      expect(firstExists.rowCount).toBe(0)
    } finally {
      await admin.end()
    }
  })

  it('11 初始化失败草稿不导致 listDrafts 整体失败', async () => {
    const t = await token('list-failed-init')
    const now = new Date().toISOString()
    const badId = '00000000-0000-4000-8000-000000000001'
    await pool.query(
      `INSERT INTO site_drafts(
        draft_id, site_id, name, sandbox_id, status, init_status, sync_status,
        last_error, created_at, updated_at
      ) VALUES ($1,NULL,'broken',$2,'error','failed','clean','sandbox missing',$3,$3)`,
      [badId, badId, now],
    )
    const me = await requestJson(app, 'GET', '/api/auth/me', { token: t })
    const userId = String((me.body.user as Record<string, unknown>).userId)
    await pool.query(
      `INSERT INTO draft_owners(draft_id, user_id, created_at) VALUES ($1,$2,$3)`,
      [badId, userId, now],
    )
    const list = await requestJson(app, 'GET', '/api/drafts', { token: t })
    expect(list.status).toBe(200)
    const drafts = list.body.drafts as Array<Record<string, unknown>>
    expect(drafts.some((d) => d.draftId === badId)).toBe(true)
    expect(drafts.find((d) => d.draftId === badId)?.initStatus).toBe('failed')
  })
})

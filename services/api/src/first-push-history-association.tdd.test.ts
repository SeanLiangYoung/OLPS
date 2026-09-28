import fs from 'node:fs/promises'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { appConfig } from './config.js'
import { app } from './app.js'
import { migrateToCollaborationModel } from './migrate.js'
import { stableDraftIdForLegacySite } from './migration-sandbox.js'
import { createFullLegacyTenantSchema } from './test-support/legacy-schema.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { hashPassword } from './password.js'

const LEGACY_SITE = 'legacy-site-1'

function clearMigrationEnv(): void {
  delete process.env.MIGRATION_SITE_OWNERS
  delete process.env.MIGRATION_KB_OWNERS
}

function setLegacyMigrationEnv(): void {
  process.env.MIGRATION_SITE_OWNERS = JSON.stringify({
    [LEGACY_SITE]: ['seanliang', 'test'],
  })
  process.env.MIGRATION_KB_OWNERS = JSON.stringify({ 'legacy-kb-1': ['seanliang'] })
}

async function seedUsers(pool: ReturnType<typeof createTestPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      account TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `)
  const now = new Date().toISOString()
  for (const [userId, account, name] of [
    ['user-sean', 'seanliang', 'Sean'],
    ['user-test', 'test', 'Test'],
  ] as const) {
    await pool.query(
      `INSERT INTO users(user_id, account, password_hash, name, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (user_id) DO NOTHING`,
      [userId, account, hashPassword('migrate-review-pass'), name, now],
    )
  }
}

async function loginToken(account: string): Promise<string> {
  const login = await requestJson(app, 'POST', '/api/auth/login', {
    body: { account, password: 'migrate-review-pass' },
  })
  expect(login.status).toBe(200)
  return String((login.body as { accessToken: string }).accessToken)
}

function assertPushReady(status: number, body: Record<string, unknown>): void {
  if (status === 200) {
    return
  }
  throw new Error(
    `首次 push 准备失败 status=${status} error=${JSON.stringify(body.error ?? body)}`,
  )
}

const pool = createTestPool()

beforeEach(async () => {
  clearMigrationEnv()
  await resetTestDatabase()
  await fs.rm(appConfig.sandboxRoot, { force: true, recursive: true })
  await fs.mkdir(appConfig.sandboxRoot, { recursive: true })
})

afterAll(async () => {
  await pool.end()
})

describe('首次发布历史 site_id 关联 RED', () => {
  it('legacy 全量历史在首次 push 后写入真实 siteId 且撤权后不可经网站 API 访问', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()
    await migrateToCollaborationModel(pool)

    const draftId = stableDraftIdForLegacySite(LEGACY_SITE)
    const tokenSean = await loginToken('seanliang')
    const tokenTest = await loginToken('test')

    const beforeInquiries = (
      await pool.query(`SELECT * FROM inquiries ORDER BY inquiry_id`)
    ).rows
    const beforeOutbox = (
      await pool.query(`SELECT * FROM inquiry_email_outbox ORDER BY outbox_id`)
    ).rows
    const beforeReports = (await pool.query(`SELECT * FROM reports ORDER BY report_id`)).rows
    const beforeJobs = (await pool.query(`SELECT * FROM jobs ORDER BY job_id`)).rows
    const beforeAnalytics = (
      await pool.query(`SELECT * FROM analytics_events ORDER BY event_id`)
    ).rows
    const beforeIntegrations = (
      await pool.query(`SELECT * FROM site_integrations ORDER BY draft_id`)
    ).rows

    expect(beforeInquiries.every((row) => row.site_id === null)).toBe(true)
    expect(beforeReports.every((row) => row.site_id === null)).toBe(true)

    const push = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token: tokenSean })
    assertPushReady(push.status, push.body)
    const siteId = String((push.body.site as Record<string, unknown>).siteId)

    for (const row of beforeInquiries) {
      const after = (
        await pool.query(`SELECT * FROM inquiries WHERE inquiry_id=$1`, [row.inquiry_id])
      ).rows[0]!
      expect(String(after.site_id)).toBe(siteId)
      expect(String(after.draft_id)).toBe(String(row.draft_id))
      expect(after.payload).toEqual(row.payload)
      expect(new Date(String(after.created_at)).toISOString()).toBe(
        new Date(String(row.created_at)).toISOString(),
      )
    }

    for (const row of beforeOutbox) {
      const after = (
        await pool.query(`SELECT * FROM inquiry_email_outbox WHERE outbox_id=$1`, [row.outbox_id])
      ).rows[0]!
      expect(String(after.site_id)).toBe(siteId)
      expect(Number(after.inquiry_id)).toBe(Number(row.inquiry_id))
      expect(after.payload).toEqual(row.payload)
    }

    for (const row of beforeReports) {
      const after = (
        await pool.query(`SELECT * FROM reports WHERE report_id=$1`, [row.report_id])
      ).rows[0]!
      expect(String(after.site_id)).toBe(siteId)
      expect(after.checklist).toEqual(row.checklist)
      expect(Number(after.score)).toBe(Number(row.score))
    }

    for (const row of beforeJobs) {
      const after = (await pool.query(`SELECT * FROM jobs WHERE job_id=$1`, [row.job_id])).rows[0]!
      expect(String(after.site_id)).toBe(siteId)
      expect(after.request).toEqual(row.request)
    }

    for (const row of beforeAnalytics) {
      const after = (
        await pool.query(`SELECT * FROM analytics_events WHERE event_id=$1`, [row.event_id])
      ).rows[0]!
      expect(String(after.site_id)).toBe(siteId)
      expect(after.payload).toEqual(row.payload)
    }

    for (const row of beforeIntegrations) {
      const after = (
        await pool.query(`SELECT * FROM site_integrations WHERE draft_id=$1`, [row.draft_id])
      ).rows[0]!
      expect(String(after.site_id)).toBe(siteId)
    }

    const siteInquiries = await requestJson(app, 'GET', `/api/sites/${siteId}/inquiries`, {
      token: tokenTest,
    })
    expect(siteInquiries.status).toBe(200)
    expect((siteInquiries.body.inquiries as unknown[]).length).toBeGreaterThan(0)

    const siteReports = await requestJson(app, 'GET', `/api/sites/${siteId}/reports`, {
      token: tokenTest,
    })
    expect(siteReports.status).toBe(200)
    expect((siteReports.body.reports as unknown[]).length).toBeGreaterThan(0)

    const reportDetail = await requestJson(app, 'GET', '/api/reports/legacy-report-1', {
      token: tokenTest,
    })
    expect(reportDetail.status).toBe(200)
    expect(String((reportDetail.body.report as Record<string, unknown>).siteId)).toBe(siteId)

    const meTest = await requestJson(app, 'GET', '/api/auth/me', { token: tokenTest })
    const userIdTest = String((meTest.body.user as Record<string, unknown>).userId)
    const revoke = await requestJson(
      app,
      'DELETE',
      `/api/sites/${siteId}/owners/${userIdTest}`,
      { token: tokenSean },
    )
    expect(revoke.status).toBe(200)

    const deniedInq = await requestJson(app, 'GET', `/api/sites/${siteId}/inquiries`, {
      token: tokenTest,
    })
    expect(deniedInq.status).toBe(403)

    const deniedReport = await requestJson(app, 'GET', '/api/reports/legacy-report-1', {
      token: tokenTest,
    })
    expect(deniedReport.status).toBe(403)
  })

  it('基于已发布站点的新草稿 push 不得覆盖站点唯一 integrations 行', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()
    await migrateToCollaborationModel(pool)

    const draftId = stableDraftIdForLegacySite(LEGACY_SITE)
    const tokenSean = await loginToken('seanliang')

    const pushA = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token: tokenSean })
    assertPushReady(pushA.status, pushA.body)
    const siteId = String((pushA.body.site as Record<string, unknown>).siteId)

    const patchPrimary = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/integrations`, {
      token: tokenSean,
      body: { gaConnected: true, gaPropertyId: 'GA-SITE-PRIMARY' },
    })
    expect(patchPrimary.status).toBe(200)

    const rowAfterPrimary = (
      await pool.query(`SELECT * FROM site_integrations WHERE draft_id=$1`, [draftId])
    ).rows[0]!
    expect(String(rowAfterPrimary.ga_property_id)).toBe('GA-SITE-PRIMARY')
    expect(String(rowAfterPrimary.site_id)).toBe(siteId)

    const fork = await requestJson(app, 'POST', '/api/drafts', {
      token: tokenSean,
      body: { name: 'Fork Draft', siteId },
    })
    expect(fork.status).toBe(201)
    const forkDraftId = String((fork.body.draft as Record<string, unknown>).draftId)

    const patchFork = await requestJson(app, 'PATCH', `/api/drafts/${forkDraftId}/integrations`, {
      token: tokenSean,
      body: { gaConnected: true, gaPropertyId: 'GA-FORK-OVERRIDE' },
    })
    expect(patchFork.status).toBe(200)

    const siteViewAfterPatch = await requestJson(app, 'GET', `/api/sites/${siteId}/integrations`, {
      token: tokenSean,
    })
    expect(siteViewAfterPatch.status).toBe(200)
    expect(
      String((siteViewAfterPatch.body.integrations as Record<string, unknown>).gaPropertyId),
    ).toBe('GA-FORK-OVERRIDE')

    const pushFork = await requestJson(app, 'POST', `/api/drafts/${forkDraftId}/push`, {
      token: tokenSean,
    })
    assertPushReady(pushFork.status, pushFork.body)

    const siteRows = await pool.query(`SELECT * FROM site_integrations WHERE site_id=$1`, [siteId])
    expect(siteRows.rowCount).toBe(1)
    expect(String(siteRows.rows[0]!.ga_property_id)).toBe('GA-FORK-OVERRIDE')

    const siteView = await requestJson(app, 'GET', `/api/sites/${siteId}/integrations`, {
      token: tokenSean,
    })
    expect(siteView.status).toBe(200)
    expect(String((siteView.body.integrations as Record<string, unknown>).gaPropertyId)).toBe(
      'GA-FORK-OVERRIDE',
    )
  })
})

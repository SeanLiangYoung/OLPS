import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SITE_PATHS } from '@olps/sync'
import { app } from './app.js'
import {
  legacySitesHaveTenantId,
  migrateToCollaborationModel,
  migrationFingerprint,
} from './migrate.js'
import { stableDraftIdForLegacySite } from './migration-sandbox.js'
import { createFullLegacyTenantSchema } from './test-support/legacy-schema.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import fs from 'node:fs/promises'
import { appConfig } from './config.js'
import { resetTestSandboxes } from './test-support/reset-test-sandboxes.js'

function setMigrationEnv(): void {
  process.env.MIGRATION_SITE_OWNERS = JSON.stringify({
    'legacy-site-1': ['legacy-owner'],
  })
  process.env.MIGRATION_KB_OWNERS = JSON.stringify({
    'legacy-kb-1': ['legacy-owner'],
  })
}

function clearMigrationEnv(): void {
  delete process.env.MIGRATION_SITE_OWNERS
  delete process.env.MIGRATION_KB_OWNERS
}

async function seedMigrationUser(pool: ReturnType<typeof createTestPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      account TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `)
  await pool.query(`
    INSERT INTO users(user_id, account, password_hash, name, created_at, updated_at)
    VALUES ('user-migrate-1', 'legacy-owner', 'hash', 'Legacy Owner', NOW(), NOW())
    ON CONFLICT (user_id) DO NOTHING
  `)
}

describe('协作模型数据库迁移', () => {
  const pool = createTestPool()

  beforeEach(async () => {
    clearMigrationEnv()
    await resetTestDatabase()
    await resetTestSandboxes()
  })

  afterAll(async () => {
    clearMigrationEnv()
    await pool.end()
  })

  it('旧 tenant 全库数据缺少所有权映射时迁移明确终止', async () => {
    await createFullLegacyTenantSchema(pool)
    await seedMigrationUser(pool)
    await expect(migrateToCollaborationModel(pool)).rejects.toThrow(/MIGRATION_SITE_OWNERS/)
    expect(await legacySitesHaveTenantId(pool)).toBe(true)
    const pages = await pool.query(`SELECT page_id, slug FROM pages ORDER BY slug`)
    expect(pages.rows.map((r) => String(r.slug))).toEqual(['about', 'home'])
  })


  it('完整迁移保留全部业务表字段与关联，并初始化真实 sandbox Git', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedMigrationUser(pool)
    setMigrationEnv()

    await migrateToCollaborationModel(pool)

    expect(await legacySitesHaveTenantId(pool)).toBe(false)
    expect(await columnExists(pool, 'sites', 'tenant_id')).toBe(false)

    const sites = await pool.query(`SELECT * FROM sites`)
    expect(sites.rowCount).toBe(0)

    const draftId = stableDraftIdForLegacySite('legacy-site-1')
    const draft = await pool.query(`SELECT * FROM site_drafts WHERE draft_id=$1`, [draftId])
    expect(draft.rowCount).toBe(1)
    expect(String(draft.rows[0]!.pending_site_id)).toBe('legacy-site-1')
    expect(String(draft.rows[0]!.head_commit_id)).toMatch(/^[0-9a-f]{40}$/)

    const home = await pool.query(
      `SELECT page_id, slug, title, seo, body FROM pages WHERE draft_id=$1 AND slug='home'`,
      [draftId],
    )
    expect(home.rowCount).toBe(1)
    expect(String(home.rows[0]!.page_id)).toBe('legacy-page-home')
    expect((home.rows[0]!.seo as { title: string }).title).toBe('Home')

    const job = await pool.query(`SELECT job_id, type, status, request FROM jobs WHERE job_id='legacy-job-1'`)
    expect(job.rowCount).toBe(1)
    expect(String(job.rows[0]!.type)).toBe('generate_page')
    expect(String(job.rows[0]!.status)).toBe('completed')

    const report = await pool.query(
      `SELECT report_id, score, draft_id, page_id FROM reports WHERE report_id='legacy-report-1'`,
    )
    expect(report.rowCount).toBe(1)
    expect(Number(report.rows[0]!.score)).toBe(80)
    expect(String(report.rows[0]!.draft_id)).toBe(draftId)

    const integration = await pool.query(
      `SELECT draft_id, site_id, ads_connected FROM site_integrations WHERE draft_id=$1`,
      [draftId],
    )
    expect(integration.rowCount).toBe(1)
    expect(integration.rows[0]!.site_id).toBeNull()

    const analytics = await pool.query(
      `SELECT event_id, name, draft_id, site_id FROM analytics_events WHERE name='page_view'`,
    )
    expect(analytics.rowCount).toBe(1)
    expect(String(analytics.rows[0]!.draft_id)).toBe(draftId)
    expect(analytics.rows[0]!.site_id).toBeNull()

    const inquiry = await pool.query(
      `SELECT inquiry_id, draft_id, site_id, payload FROM inquiries WHERE draft_id=$1`,
      [draftId],
    )
    expect(inquiry.rowCount).toBe(1)
    expect(String(inquiry.rows[0]!.draft_id)).toBe(draftId)
    expect(inquiry.rows[0]!.site_id).toBeNull()
    expect((inquiry.rows[0]!.payload as { email: string }).email).toBe('lead@example.com')

    const outbox = await pool.query(`SELECT outbox_id, inquiry_id, site_id FROM inquiry_email_outbox`)
    expect(outbox.rowCount).toBe(1)
    expect(Number(outbox.rows[0]!.inquiry_id)).toBe(Number(inquiry.rows[0]!.inquiry_id))

    const kb = await pool.query(`SELECT kb_id, name, owner_user_id FROM knowledge_bases`)
    expect(kb.rowCount).toBe(1)
    expect(String(kb.rows[0]!.owner_user_id)).toBe('user-migrate-1')

    const doc = await pool.query(`SELECT doc_id, title, content FROM knowledge_documents`)
    expect(doc.rowCount).toBe(1)
    expect(String(doc.rows[0]!.title)).toBe('Doc')

    const seqInq = await pool.query(`SELECT nextval(pg_get_serial_sequence('inquiries','inquiry_id')) AS n`)
    expect(Number(seqInq.rows[0]!.n)).toBeGreaterThan(Number(inquiry.rows[0]!.inquiry_id))

    const sandboxPath = `${appConfig.sandboxRoot}/${draftId}`
    const manifest = await fs.readFile(`${sandboxPath}/${SITE_PATHS.manifest}`, 'utf8')
    expect(manifest).toContain('buildCommand')
    const pageFile = await fs.readFile(
      `${sandboxPath}/${SITE_PATHS.pagesDir}/legacy-page-home.json`,
      'utf8',
    )
    expect(pageFile).toContain('legacy-page-home')

    await migrateToCollaborationModel(pool)
    const drafts2 = await pool.query(`SELECT COUNT(*)::int AS c FROM site_drafts`)
    expect(Number(drafts2.rows[0]!.c)).toBe(1)
    void migrationFingerprint('legacy-site-1')
  })

  it('迁移后所有者可通过 draft 历史接口读取询盘', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedMigrationUser(pool)
    setMigrationEnv()
    await migrateToCollaborationModel(pool)

    const draftId = stableDraftIdForLegacySite('legacy-site-1')
    const { hashPassword } = await import('./password.js')
    await pool.query(`UPDATE users SET password_hash=$1 WHERE account='legacy-owner'`, [
      hashPassword('migrate-pass'),
    ])
    const loginOk = await requestJson(app, 'POST', '/api/auth/login', {
      body: { account: 'legacy-owner', password: 'migrate-pass' },
    })
    expect(loginOk.status).toBe(200)
    const token = String((loginOk.body as { accessToken: string }).accessToken)

    const list = await requestJson(app, 'GET', `/api/drafts/${draftId}/inquiries`, { token })
    expect(list.status).toBe(200)
    const inquiries = list.body.inquiries as Array<Record<string, unknown>>
    expect(inquiries.length).toBe(1)
    expect((inquiries[0]!.payload as { email: string }).email).toBe('lead@example.com')
    expect(inquiries[0]!.siteId).toBeNull()
  })
})

async function columnExists(
  pool: ReturnType<typeof createTestPool>,
  table: string,
  column: string,
): Promise<boolean> {
  const row = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2`,
    [table, column],
  )
  return (row.rowCount ?? 0) > 0
}

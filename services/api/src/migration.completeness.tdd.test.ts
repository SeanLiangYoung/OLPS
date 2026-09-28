import { randomBytes } from 'node:crypto'
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SITE_PATHS, SyncWorkspace, pageJsonPath } from '@olps/sync'
import { defaultSiteSettings, type SiteSettings } from '@olps/domain'
import { app } from './app.js'
import { legacySitesHaveTenantId, migrateToCollaborationModel } from './migrate.js'
import {
  initializeLegacySiteSandbox,
  legacyDraftSandboxExists,
  stableDraftIdForLegacySite,
  type LegacyPageRow,
} from './migration-sandbox.js'
import { readPageFromWorkspace, writePageToWorkspace } from './page-sandbox.js'
import { createFullLegacyTenantSchema, LEGACY_SETTINGS_JSON } from './test-support/legacy-schema.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { appConfig } from './config.js'
import { hashPassword } from './password.js'

const LEGACY_SITE = 'legacy-site-1'
const apiPackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bootstrapUsersCli = path.join(apiPackageRoot, 'src', 'migration-bootstrap-users.ts')

function clearMigrationEnv(): void {
  delete process.env.MIGRATION_SITE_OWNERS
  delete process.env.MIGRATION_KB_OWNERS
  delete process.env.MIGRATION_BOOTSTRAP_USERS
  delete process.env.MIGRATION_BOOTSTRAP_CREDENTIALS_PATH
}

function legacySiteSettings(): SiteSettings {
  return {
    ...defaultSiteSettings(appConfig.defaultScreenCap),
    ...(JSON.parse(LEGACY_SETTINGS_JSON) as SiteSettings),
  }
}

async function resetSandboxes(): Promise<void> {
  await fs.rm(appConfig.sandboxRoot, { force: true, recursive: true })
  await fs.mkdir(appConfig.sandboxRoot, { recursive: true })
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
    ['user-outsider', 'outsider', 'Out'],
  ] as const) {
    await pool.query(
      `INSERT INTO users(user_id, account, password_hash, name, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (user_id) DO NOTHING`,
      [userId, account, hashPassword('migrate-review-pass'), name, now],
    )
  }
}

function setLegacyMigrationEnv(): void {
  process.env.MIGRATION_SITE_OWNERS = JSON.stringify({ [LEGACY_SITE]: ['seanliang'] })
  process.env.MIGRATION_KB_OWNERS = JSON.stringify({ 'legacy-kb-1': ['seanliang'] })
}

async function initFullLegacySandbox(pool: ReturnType<typeof createTestPool>): Promise<string> {
  const siteRow = (
    await pool.query(`SELECT * FROM sites WHERE site_id=$1`, [LEGACY_SITE])
  ).rows[0]!
  const pageRows = await pool.query(`SELECT * FROM pages WHERE site_id=$1 ORDER BY page_id`, [
    LEGACY_SITE,
  ])
  const draftId = stableDraftIdForLegacySite(LEGACY_SITE)
  await initializeLegacySiteSandbox({
    legacySiteId: LEGACY_SITE,
    draftId,
    sandboxId: draftId,
    pendingSiteId: LEGACY_SITE,
    siteName: String(siteRow.name),
    settings: legacySiteSettings(),
    pages: pageRows.rows as LegacyPageRow[],
    skipIfPresent: false,
  })
  return draftId
}

function runBootstrapUsersCli(extraEnv: Record<string, string>): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ['--import', 'tsx', bootstrapUsersCli], {
    cwd: apiPackageRoot,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  })
}

function runBootstrapUsersCliAsync(
  extraEnv: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', bootstrapUsersCli], {
      cwd: apiPackageRoot,
      env: { ...process.env, ...extraEnv },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function loginToken(account: string): Promise<string> {
  const login = await requestJson(app, 'POST', '/api/auth/login', {
    body: { account, password: 'migrate-review-pass' },
  })
  expect(login.status).toBe(200)
  return String((login.body as { accessToken: string }).accessToken)
}

type LegacySnapshot = {
  sites: Array<Record<string, unknown>>
  pages: Array<Record<string, unknown>>
  inquiries: Array<Record<string, unknown>>
  outbox: Array<Record<string, unknown>>
  knowledgeBases: Array<Record<string, unknown>>
  knowledgeDocuments: Array<Record<string, unknown>>
  jobs: Array<Record<string, unknown>>
  integrations: Array<Record<string, unknown>>
  reports: Array<Record<string, unknown>>
  analytics: Array<Record<string, unknown>>
}

async function captureLegacySnapshot(pool: ReturnType<typeof createTestPool>): Promise<LegacySnapshot> {
  return {
    sites: (await pool.query(`SELECT * FROM sites ORDER BY site_id`)).rows,
    pages: (await pool.query(`SELECT * FROM pages ORDER BY page_id`)).rows,
    inquiries: (await pool.query(`SELECT * FROM inquiries ORDER BY inquiry_id`)).rows,
    outbox: (await pool.query(`SELECT * FROM inquiry_email_outbox ORDER BY outbox_id`)).rows,
    knowledgeBases: (await pool.query(`SELECT * FROM knowledge_bases ORDER BY kb_id`)).rows,
    knowledgeDocuments: (await pool.query(`SELECT * FROM knowledge_documents ORDER BY doc_id`)).rows,
    jobs: (await pool.query(`SELECT * FROM jobs ORDER BY job_id`)).rows,
    integrations: (await pool.query(`SELECT * FROM site_integrations ORDER BY site_id`)).rows,
    reports: (await pool.query(`SELECT * FROM reports ORDER BY report_id`)).rows,
    analytics: (await pool.query(`SELECT * FROM analytics_events ORDER BY event_id`)).rows,
  }
}

function iso(value: unknown): string {
  return new Date(String(value)).toISOString()
}

const sharedPool = createTestPool()

afterAll(async () => {
  await sharedPool.end()
})

describe('迁移完整性 RED', () => {
  const pool = sharedPool

  beforeEach(async () => {
    clearMigrationEnv()
    await resetTestDatabase()
    await resetSandboxes()
  })

  it('legacy 仍在且完整 sandbox 已存在时，仅修改原库页面 body 后迁移必须拒绝且 legacy 不变', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()
    await initFullLegacySandbox(pool)

    await pool.query(`
      UPDATE pages SET body='{"html":"<h1>Legacy body changed</h1>"}'::jsonb
      WHERE page_id='legacy-page-home'
    `)

    await expect(migrateToCollaborationModel(pool)).rejects.toThrow(
      /sandbox|不一致|指纹|输入|legacy|页面|body|seo/i,
    )
    expect(await legacySitesHaveTenantId(pool)).toBe(true)
    const body = (
      await pool.query(`SELECT body FROM pages WHERE page_id='legacy-page-home'`)
    ).rows[0]!.body as { html: string }
    expect(body.html).toContain('Legacy body changed')
  })

  it('legacy 仍在且完整 sandbox 已存在时，仅修改原库页面 seo 后迁移必须拒绝且 legacy 不变', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()
    await initFullLegacySandbox(pool)

    await pool.query(`
      UPDATE pages SET seo='{"title":"Changed SEO","description":"Changed"}'::jsonb
      WHERE page_id='legacy-page-home'
    `)

    await expect(migrateToCollaborationModel(pool)).rejects.toThrow(
      /sandbox|不一致|指纹|输入|legacy|页面|body|seo/i,
    )
    expect(await legacySitesHaveTenantId(pool)).toBe(true)
  })

  it('legacy 仍在且 sandbox 经 SyncWorkspace 干净编辑 body 后迁移必须拒绝', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()
    const draftId = await initFullLegacySandbox(pool)

    const workspace = await SyncWorkspace.open({
      sandboxRoot: appConfig.sandboxRoot,
      draftId,
      remote: requireRemoteServiceConfig(),
      remoteSiteId: null,
      baseCommitId: null,
      headCommitId: null,
    })
    const json = await readPageFromWorkspace(workspace, 'legacy-page-home')
    expect(json).toBeTruthy()
    json!.body = { html: '<h1>Sandbox edited clean</h1>' }
    await writePageToWorkspace(workspace, json!)
    await workspace.saveVersion('completeness-test: clean body edit')
    expect(workspace.getState().status).toBe('clean')

    await expect(migrateToCollaborationModel(pool)).rejects.toThrow(
      /sandbox|不一致|指纹|输入|legacy|页面|body|seo/i,
    )
    expect(await legacySitesHaveTenantId(pool)).toBe(true)
  })

  it('legacy 仍在且完整 sandbox 未修改时迁移应成功', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()
    await initFullLegacySandbox(pool)

    await expect(migrateToCollaborationModel(pool)).resolves.toBeUndefined()
    expect(await legacySitesHaveTenantId(pool)).toBe(false)
  })

  it('legacy 仍在且完整 sandbox 未修改时重复校验 sandbox 应成功', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()
    const siteRow = (
      await pool.query(`SELECT * FROM sites WHERE site_id=$1`, [LEGACY_SITE])
    ).rows[0]!
    const pageRows = await pool.query(`SELECT * FROM pages WHERE site_id=$1 ORDER BY page_id`, [
      LEGACY_SITE,
    ])
    const draftId = stableDraftIdForLegacySite(LEGACY_SITE)
    await initializeLegacySiteSandbox({
      legacySiteId: LEGACY_SITE,
      draftId,
      sandboxId: draftId,
      pendingSiteId: LEGACY_SITE,
      siteName: String(siteRow.name),
      settings: legacySiteSettings(),
      pages: pageRows.rows as LegacyPageRow[],
      skipIfPresent: false,
    })
    await initializeLegacySiteSandbox({
      legacySiteId: LEGACY_SITE,
      draftId,
      sandboxId: draftId,
      pendingSiteId: LEGACY_SITE,
      siteName: String(siteRow.name),
      settings: legacySiteSettings(),
      pages: pageRows.rows as LegacyPageRow[],
      skipIfPresent: true,
    })
    await expect(migrateToCollaborationModel(pool)).resolves.toBeUndefined()
  })

  it('legacy 仍在且 sandbox 仅修改 public/index.html 并提交后迁移必须拒绝', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()
    const draftId = await initFullLegacySandbox(pool)

    const workspace = await SyncWorkspace.open({
      sandboxRoot: appConfig.sandboxRoot,
      draftId,
      remote: requireRemoteServiceConfig(),
      remoteSiteId: null,
      baseCommitId: null,
      headCommitId: null,
    })
    const publicIndexPath = `${SITE_PATHS.publicDir}/index.html`
    const priorPublic = (await workspace.readFile(publicIndexPath)).toString('utf8')
    await workspace.writeFile(
      publicIndexPath,
      Buffer.from(`${priorPublic}\n<!-- completeness-user-public-edit -->\n`, 'utf8'),
    )
    await workspace.saveVersion('completeness-test: user public index edit')
    expect(workspace.getState().status).toBe('clean')
    const headBeforeReject = workspace.getState().headCommitId
    const publicAfterEdit = (await workspace.readFile(publicIndexPath)).toString('utf8')

    await expect(migrateToCollaborationModel(pool)).rejects.toThrow(
      /sandbox|不一致|public|校验|HEAD|build|迁移|用户/i,
    )
    expect(await legacySitesHaveTenantId(pool)).toBe(true)

    const workspaceAfter = await SyncWorkspace.open({
      sandboxRoot: appConfig.sandboxRoot,
      draftId,
      remote: requireRemoteServiceConfig(),
      remoteSiteId: null,
      baseCommitId: null,
      headCommitId: null,
    })
    expect(workspaceAfter.getState().headCommitId).toBe(headBeforeReject)
    expect((await workspaceAfter.readFile(publicIndexPath)).toString('utf8')).toBe(publicAfterEdit)
    expect(publicAfterEdit).toContain('completeness-user-public-edit')
  })

  it('legacy 仍在且 sandbox 含额外页面文件时迁移必须拒绝', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()
    const draftId = await initFullLegacySandbox(pool)

    const workspace = await SyncWorkspace.open({
      sandboxRoot: appConfig.sandboxRoot,
      draftId,
      remote: requireRemoteServiceConfig(),
      remoteSiteId: null,
      baseCommitId: null,
      headCommitId: null,
    })
    await writePageToWorkspace(workspace, {
      pageId: 'legacy-page-extra-only-sandbox',
      kind: 'content',
      slug: 'extra-sandbox-only',
      title: 'Extra Sandbox Page',
      status: 'draft',
      locale: 'en',
      seo: { title: 'Extra', description: 'Extra description' },
      body: { html: '<h1>Extra</h1>' },
      publishedAt: null,
    })
    await workspace.saveVersion('completeness-test: extra page in sandbox')
    expect(workspace.getState().status).toBe('clean')

    await expect(migrateToCollaborationModel(pool)).rejects.toThrow(
      /sandbox|不一致|指纹|输入|legacy|页面|多余|额外/i,
    )
    expect(await legacySitesHaveTenantId(pool)).toBe(true)
  })

  it('迁移在 legacy 读取与 sandbox 构建前应申请 sites 排他锁并在阻塞连接释放前不得完成', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()

    const draftId = stableDraftIdForLegacySite(LEGACY_SITE)
    const originalBody = (
      await pool.query(`SELECT body FROM pages WHERE page_id='legacy-page-home'`)
    ).rows[0]!.body

    const blocker = await pool.connect()
    const mutator = await pool.connect()
    let migrateSettled = false
    let mutateSettled = false
    let migratePromise: Promise<void> = Promise.resolve()
    let mutatePromise: Promise<unknown> = Promise.resolve()
    try {
      await blocker.query('BEGIN')
      await blocker.query('LOCK TABLE sites IN ACCESS SHARE MODE')

      migratePromise = migrateToCollaborationModel(pool).finally(() => {
        migrateSettled = true
      })

      let mutateStarted = false
      const deadline = Date.now() + 90_000
      let sawExclusiveWait = false
      while (Date.now() < deadline) {
        const pagesExclusive = await pool.query(`
          SELECT l.pid, l.granted
          FROM pg_locks l
          JOIN pg_class c ON c.oid = l.relation
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema() AND c.relname = 'pages'
            AND l.mode = 'AccessExclusiveLock' AND l.granted = true
        `)
        if ((pagesExclusive.rowCount ?? 0) > 0 && !mutateStarted) {
          mutateStarted = true
          mutatePromise = mutator
            .query(
              `UPDATE pages SET body='{"html":"<p>concurrent-mutation-blocked</p>"}'::jsonb
               WHERE page_id='legacy-page-home'`,
            )
            .finally(() => {
              mutateSettled = true
            })
        }

        const waitLocks = await pool.query(`
          SELECT l.pid, l.mode, l.granted
          FROM pg_locks l
          JOIN pg_class c ON c.oid = l.relation
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema() AND c.relname = 'sites'
            AND l.mode = 'AccessExclusiveLock' AND l.granted = false
        `)
        if ((waitLocks.rowCount ?? 0) > 0) {
          sawExclusiveWait = true
          expect(await legacyDraftSandboxExists(draftId)).toBe(false)
          expect(mutateStarted).toBe(true)
          expect(mutateSettled).toBe(false)
          break
        }
        if (migrateSettled) {
          break
        }
        await delay(200)
      }
      expect(sawExclusiveWait).toBe(true)
      expect(await legacySitesHaveTenantId(pool)).toBe(true)
    } finally {
      try {
        await blocker.query('COMMIT')
      } catch {
        await blocker.query('ROLLBACK').catch(() => undefined)
      }
      await migratePromise.catch(() => undefined)
      await mutatePromise.catch(() => undefined)
      if (await legacySitesHaveTenantId(pool)) {
        const bodyAfter = (
          await pool.query(`SELECT body FROM pages WHERE page_id='legacy-page-home'`)
        ).rows[0]?.body
        if (bodyAfter !== undefined) {
          expect(bodyAfter).toEqual(originalBody)
        }
      }
      blocker.release()
      mutator.release()
    }
  }, 120_000)

  it('完整字段保存：10 张 legacy 表主键/日期/JSON/状态/关联与三条序列均保留', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()
    const before = await captureLegacySnapshot(pool)
    expect(before.sites.length).toBe(1)
    expect(before.pages.length).toBe(2)

    await migrateToCollaborationModel(pool)
    const draftId = stableDraftIdForLegacySite(LEGACY_SITE)

    const legacySite = before.sites[0]!
    const draft = (await pool.query(`SELECT * FROM site_drafts WHERE draft_id=$1`, [draftId])).rows[0]!
    expect(String(draft.name)).toBe(String(legacySite.name))
    expect(iso(draft.created_at)).toBe(iso(legacySite.created_at))
    expect(iso(draft.updated_at)).toBe(iso(legacySite.updated_at))

    const tokenSean = await loginToken('seanliang')
    const draftRes = await requestJson(app, 'GET', `/api/drafts/${draftId}`, { token: tokenSean })
    expect(draftRes.status).toBe(200)
    const expectedSettings: SiteSettings = {
      ...defaultSiteSettings(appConfig.defaultScreenCap),
      ...(legacySite.settings as SiteSettings),
    }
    expect((draftRes.body as { draft: { settings: SiteSettings } }).draft.settings).toEqual(
      expectedSettings,
    )

    for (const legacyPage of before.pages) {
      const pageId = String(legacyPage.page_id)
      const row = (
        await pool.query(`SELECT * FROM pages WHERE draft_id=$1 AND page_id=$2`, [draftId, pageId])
      ).rows[0]!
      expect(String(row.kind)).toBe(String(legacyPage.kind))
      expect(String(row.slug)).toBe(String(legacyPage.slug))
      expect(String(row.title)).toBe(String(legacyPage.title))
      expect(String(row.status)).toBe(String(legacyPage.status))
      expect(String(row.locale)).toBe(String(legacyPage.locale))
      expect(row.seo).toEqual(legacyPage.seo)
      expect(row.body).toEqual(legacyPage.body)
      expect(iso(row.created_at)).toBe(iso(legacyPage.created_at))
      expect(iso(row.updated_at)).toBe(iso(legacyPage.updated_at))
      if (legacyPage.published_at) {
        expect(iso(row.published_at)).toBe(iso(legacyPage.published_at))
      } else {
        expect(row.published_at).toBeNull()
      }
      expect(row.site_id).toBeNull()
    }

    const legacyInq = before.inquiries[0]!
    const inq = (
      await pool.query(`SELECT * FROM inquiries WHERE inquiry_id=$1`, [legacyInq.inquiry_id])
    ).rows[0]!
    expect(Number(inq.inquiry_id)).toBe(Number(legacyInq.inquiry_id))
    expect(String(inq.draft_id)).toBe(draftId)
    expect(inq.site_id).toBeNull()
    expect(String(inq.page_id)).toBe(String(legacyInq.page_id))
    expect(inq.payload).toEqual(legacyInq.payload)
    expect(String(inq.status)).toBe(String(legacyInq.status))
    expect(iso(inq.created_at)).toBe(iso(legacyInq.created_at))
    expect(iso(inq.updated_at)).toBe(iso(legacyInq.updated_at))

    const legacyOut = before.outbox[0]!
    const out = (
      await pool.query(`SELECT * FROM inquiry_email_outbox WHERE outbox_id=$1`, [legacyOut.outbox_id])
    ).rows[0]!
    expect(Number(out.outbox_id)).toBe(Number(legacyOut.outbox_id))
    expect(Number(out.inquiry_id)).toBe(Number(legacyOut.inquiry_id))
    expect(out.site_id).toBeNull()
    expect(out.payload).toEqual(legacyOut.payload)
    expect(iso(out.created_at)).toBe(iso(legacyOut.created_at))

    const legacyKb = before.knowledgeBases[0]!
    const kb = (await pool.query(`SELECT * FROM knowledge_bases WHERE kb_id=$1`, [legacyKb.kb_id]))
      .rows[0]!
    expect(String(kb.kb_id)).toBe(String(legacyKb.kb_id))
    expect(String(kb.name)).toBe(String(legacyKb.name))
    expect(iso(kb.created_at)).toBe(iso(legacyKb.created_at))
    expect(iso(kb.updated_at)).toBe(iso(legacyKb.updated_at))
    expect(String(kb.owner_user_id)).toBe('user-sean')

    const legacyDoc = before.knowledgeDocuments[0]!
    const doc = (
      await pool.query(`SELECT * FROM knowledge_documents WHERE doc_id=$1`, [legacyDoc.doc_id])
    ).rows[0]!
    expect(String(doc.doc_id)).toBe(String(legacyDoc.doc_id))
    expect(String(doc.kb_id)).toBe(String(legacyDoc.kb_id))
    expect(String(doc.title)).toBe(String(legacyDoc.title))
    expect(String(doc.content)).toBe(String(legacyDoc.content))
    expect(iso(doc.created_at)).toBe(iso(legacyDoc.created_at))

    const legacyJob = before.jobs[0]!
    const job = (await pool.query(`SELECT * FROM jobs WHERE job_id=$1`, [legacyJob.job_id])).rows[0]!
    expect(String(job.job_id)).toBe(String(legacyJob.job_id))
    expect(String(job.type)).toBe(String(legacyJob.type))
    expect(String(job.status)).toBe(String(legacyJob.status))
    expect(job.request).toEqual(legacyJob.request)
    expect(job.result).toEqual(legacyJob.result)
    expect(job.error).toEqual(legacyJob.error)
    expect(iso(job.created_at)).toBe(iso(legacyJob.created_at))
    expect(iso(job.updated_at)).toBe(iso(legacyJob.updated_at))
    expect(String(job.draft_id)).toBe(draftId)
    expect(job.site_id).toBeNull()
    expect(String(job.user_id)).toBe('user-sean')

    const legacyInt = before.integrations[0]!
    const intRow = (
      await pool.query(`SELECT * FROM site_integrations WHERE draft_id=$1`, [draftId])
    ).rows[0]!
    expect(String(intRow.draft_id)).toBe(draftId)
    expect(intRow.site_id).toBeNull()
    expect(String(intRow.ads_account_id)).toBe(String(legacyInt.ads_account_id))
    expect(Boolean(intRow.ads_connected)).toBe(Boolean(legacyInt.ads_connected))
    expect(String(intRow.ga_property_id)).toBe(String(legacyInt.ga_property_id))
    expect(Boolean(intRow.ga_connected)).toBe(Boolean(legacyInt.ga_connected))
    expect(iso(intRow.updated_at)).toBe(iso(legacyInt.updated_at))

    const legacyReport = before.reports[0]!
    const report = (
      await pool.query(`SELECT * FROM reports WHERE report_id=$1`, [legacyReport.report_id])
    ).rows[0]!
    expect(String(report.report_id)).toBe(String(legacyReport.report_id))
    expect(Number(report.score)).toBe(Number(legacyReport.score))
    expect(report.checklist).toEqual(legacyReport.checklist)
    expect(String(report.page_id)).toBe(String(legacyReport.page_id))
    expect(String(report.draft_id)).toBe(draftId)
    expect(report.site_id).toBeNull()
    expect(iso(report.created_at)).toBe(iso(legacyReport.created_at))
    expect(String(report.user_id)).toBe('user-sean')

    const legacyEv = before.analytics[0]!
    const ev = (
      await pool.query(`SELECT * FROM analytics_events WHERE event_id=$1`, [legacyEv.event_id])
    ).rows[0]!
    expect(Number(ev.event_id)).toBe(Number(legacyEv.event_id))
    expect(String(ev.draft_id)).toBe(draftId)
    expect(ev.site_id).toBeNull()
    expect(String(ev.page_id)).toBe(String(legacyEv.page_id))
    expect(String(ev.name)).toBe(String(legacyEv.name))
    expect(ev.payload).toEqual(legacyEv.payload)
    expect(iso(ev.created_at)).toBe(iso(legacyEv.created_at))

    const maxInq = Math.max(...before.inquiries.map((r) => Number(r.inquiry_id)))
    const maxOut = Math.max(...before.outbox.map((r) => Number(r.outbox_id)))
    const maxEv = Math.max(...before.analytics.map((r) => Number(r.event_id)))
    const nextInq = await pool.query(
      `SELECT nextval(pg_get_serial_sequence('inquiries','inquiry_id')) AS n`,
    )
    const nextOut = await pool.query(
      `SELECT nextval(pg_get_serial_sequence('inquiry_email_outbox','outbox_id')) AS n`,
    )
    const nextEv = await pool.query(
      `SELECT nextval(pg_get_serial_sequence('analytics_events','event_id')) AS n`,
    )
    expect(Number(nextInq.rows[0]!.n)).toBeGreaterThan(maxInq)
    expect(Number(nextOut.rows[0]!.n)).toBeGreaterThan(maxOut)
    expect(Number(nextEv.rows[0]!.n)).toBeGreaterThan(maxEv)
  })

  it('草稿历史 API：报告详情、询盘状态/重发、集成读写与 push 后仍可访问', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()
    await migrateToCollaborationModel(pool)

    const draftId = stableDraftIdForLegacySite(LEGACY_SITE)
    await pool.query(
      `INSERT INTO draft_owners(draft_id, user_id, created_at) VALUES ($1,'user-test',NOW())
       ON CONFLICT DO NOTHING`,
      [draftId],
    )
    const tokenSean = await loginToken('seanliang')
    const tokenTest = await loginToken('test')
    const tokenOutsider = await loginToken('outsider')

    const reportRes = await app.request(`http://local/api/drafts/${draftId}/reports/legacy-report-1`, {
      headers: { Authorization: `Bearer ${tokenSean}` },
    })
    expect(reportRes.status).toBe(200)
    const reportDetail = (await reportRes.json()) as { report: Record<string, unknown> }
    expect(Number(reportDetail.report.score)).toBe(80)

    const forbiddenRes = await app.request(
      `http://local/api/drafts/${draftId}/reports/legacy-report-1`,
      { headers: { Authorization: `Bearer ${tokenOutsider}` } },
    )
    expect(forbiddenRes.status).toBe(403)

    const inqRow = (await pool.query(`SELECT inquiry_id FROM inquiries LIMIT 1`)).rows[0]!
    const inquiryId = Number(inqRow.inquiry_id)
    const patchInq = await requestJson(app, 'PATCH', `/api/inquiries/${inquiryId}`, {
      token: tokenTest,
      body: { status: 'processing' },
    })
    expect(patchInq.status).toBe(200)

    const resend = await requestJson(app, 'POST', `/api/inquiries/${inquiryId}/resend`, {
      token: tokenSean,
    })
    expect(resend.status).toBe(200)

    const integrationsGetRes = await app.request(`http://local/api/drafts/${draftId}/integrations`, {
      headers: { Authorization: `Bearer ${tokenSean}` },
    })
    expect(integrationsGetRes.status).toBe(200)

    const integrationsPatchRes = await app.request(`http://local/api/drafts/${draftId}/integrations`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tokenSean}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ gaConnected: true, gaPropertyId: 'GA-COMPLETENESS-1' }),
    })
    expect(integrationsPatchRes.status).toBe(200)
    const integrationsPatch = (await integrationsPatchRes.json()) as {
      integrations: Record<string, unknown>
    }
    expect(integrationsPatch.integrations.gaPropertyId).toBe('GA-COMPLETENESS-1')

    const push = await requestJson(app, 'POST', `/api/drafts/${draftId}/push`, { token: tokenSean })
    expect(push.status, JSON.stringify(push.body)).toBe(200)
    const siteId = String((push.body.site as Record<string, unknown>).siteId)

    const afterPushRes = await app.request(
      `http://local/api/drafts/${draftId}/reports/legacy-report-1`,
      { headers: { Authorization: `Bearer ${tokenSean}` } },
    )
    expect(afterPushRes.status).toBe(200)

    const siteReportRes = await app.request(`http://local/api/reports/legacy-report-1`, {
      headers: { Authorization: `Bearer ${tokenSean}` },
    })
    expect(siteReportRes.status).toBe(200)
    const siteReport = (await siteReportRes.json()) as { report: Record<string, unknown> }
    expect(String(siteReport.report.siteId)).toBe(siteId)
  })
})

describe('bootstrap 凭据完整性 RED', () => {
  const pool = sharedPool

  beforeEach(async () => {
    clearMigrationEnv()
    await resetTestDatabase()
  })

  it('凭据路径不可写时 CLI 失败且不得留下新账号', async () => {
    await createFullLegacyTenantSchema(pool)
    const blockedFile = path.join(
      apiPackageRoot,
      '.intermediate',
      `blocked-file-${randomBytes(4).toString('hex')}.json`,
    )
    await fs.writeFile(blockedFile, '{}', 'utf8')
    const credentialsPath = path.join(blockedFile, 'creds.json')

    const run = runBootstrapUsersCli({
      MIGRATION_BOOTSTRAP_CREDENTIALS_PATH: credentialsPath,
      MIGRATION_BOOTSTRAP_USERS: JSON.stringify([{ account: 'bootstrap-fail-user', name: 'Fail' }]),
    })

    const users = await pool.query(`SELECT account FROM users WHERE account='bootstrap-fail-user'`)
    expect(users.rowCount).toBe(0)
    expect(run.status).not.toBe(0)
    await fs.rm(blockedFile, { force: true })
  })

  it('重复执行不得覆盖已有凭据文件且不得更改已有账号密码', async () => {
    await createFullLegacyTenantSchema(pool)
    const credentialsPath = path.join(
      apiPackageRoot,
      '.intermediate',
      `bootstrap-idempotent-${randomBytes(6).toString('hex')}.json`,
    )
    await fs.mkdir(path.dirname(credentialsPath), { recursive: true })

    const first = runBootstrapUsersCli({
      MIGRATION_BOOTSTRAP_CREDENTIALS_PATH: credentialsPath,
      MIGRATION_BOOTSTRAP_USERS: JSON.stringify([{ account: 'bootstrap-idem-a', name: 'A' }]),
    })
    expect(first.status).toBe(0)
    const hashAfterFirst = String(
      (await pool.query(`SELECT password_hash FROM users WHERE account='bootstrap-idem-a'`)).rows[0]!
        .password_hash,
    )
    const credFirst = await fs.readFile(credentialsPath, 'utf8')

    const second = runBootstrapUsersCli({
      MIGRATION_BOOTSTRAP_CREDENTIALS_PATH: credentialsPath,
      MIGRATION_BOOTSTRAP_USERS: JSON.stringify([
        { account: 'bootstrap-idem-a', name: 'A' },
        { account: 'bootstrap-idem-b', name: 'B' },
      ]),
    })
    expect(second.status).not.toBe(0)
    const hashAfterSecond = String(
      (await pool.query(`SELECT password_hash FROM users WHERE account='bootstrap-idem-a'`)).rows[0]!
        .password_hash,
    )
    expect(hashAfterSecond).toBe(hashAfterFirst)
    const credSecond = await fs.readFile(credentialsPath, 'utf8')
    expect(credSecond).toBe(credFirst)
    expect(
      (await pool.query(`SELECT account FROM users WHERE account='bootstrap-idem-b'`)).rowCount,
    ).toBe(0)
  })

  async function ensureAuthSessionsTable(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `)
  }

  async function assertCredentialsFileMatchesDbAndLogin(credentialsPath: string): Promise<void> {
    await fs.access(credentialsPath)
    const credentials = JSON.parse(await fs.readFile(credentialsPath, 'utf8')) as Record<
      string,
      { password: string; name: string }
    >
    const fileAccounts = Object.keys(credentials).sort()
    expect(fileAccounts.length).toBeGreaterThan(0)
    await ensureAuthSessionsTable()
    for (const account of fileAccounts) {
      expect(
        (await pool.query(`SELECT account FROM users WHERE account=$1`, [account])).rowCount,
      ).toBe(1)
      const login = await requestJson(app, 'POST', '/api/auth/login', {
        body: { account, password: credentials[account]!.password },
      })
      expect(login.status).toBe(200)
    }
    const dbAccounts = (
      await pool.query(`SELECT account FROM users WHERE account = ANY($1::text[])`, [fileAccounts])
    ).rows.map((row) => String(row.account))
    expect(dbAccounts.sort()).toEqual(fileAccounts)
  }

  it('并发同账号竞争同一凭据文件：成功者凭据必须保留且密码可登录并与数据库一致', async () => {
    await createFullLegacyTenantSchema(pool)
    const credentialsPath = path.join(
      apiPackageRoot,
      '.intermediate',
      `bootstrap-race-same-${randomBytes(6).toString('hex')}.json`,
    )
    await fs.mkdir(path.dirname(credentialsPath), { recursive: true })
    const env = {
      MIGRATION_BOOTSTRAP_CREDENTIALS_PATH: credentialsPath,
      MIGRATION_BOOTSTRAP_USERS: JSON.stringify([
        { account: 'bootstrap-race-same-user', name: 'Same' },
      ]),
    }
    const [runA, runB] = await Promise.all([
      runBootstrapUsersCliAsync(env),
      runBootstrapUsersCliAsync(env),
    ])
    const successCount = [runA.code, runB.code].filter((code) => code === 0).length
    expect(successCount).toBe(1)
    expect(
      (await pool.query(`SELECT account FROM users WHERE account='bootstrap-race-same-user'`))
        .rowCount,
    ).toBe(1)
    await assertCredentialsFileMatchesDbAndLogin(credentialsPath)
  })

  it('并发不同账号竞争同一凭据文件：成功者凭据必须保留且密码可登录并与数据库一致', async () => {
    await createFullLegacyTenantSchema(pool)
    const credentialsPath = path.join(
      apiPackageRoot,
      '.intermediate',
      `bootstrap-race-diff-${randomBytes(6).toString('hex')}.json`,
    )
    await fs.mkdir(path.dirname(credentialsPath), { recursive: true })
    const [runA, runB] = await Promise.all([
      runBootstrapUsersCliAsync({
        MIGRATION_BOOTSTRAP_CREDENTIALS_PATH: credentialsPath,
        MIGRATION_BOOTSTRAP_USERS: JSON.stringify([
          { account: 'bootstrap-race-diff-a', name: 'A' },
        ]),
      }),
      runBootstrapUsersCliAsync({
        MIGRATION_BOOTSTRAP_CREDENTIALS_PATH: credentialsPath,
        MIGRATION_BOOTSTRAP_USERS: JSON.stringify([
          { account: 'bootstrap-race-diff-b', name: 'B' },
        ]),
      }),
    ])
    const successCount = [runA.code, runB.code].filter((code) => code === 0).length
    expect(successCount).toBe(1)
    const accountsInDb = (
      await pool.query(
        `SELECT account FROM users WHERE account IN ('bootstrap-race-diff-a','bootstrap-race-diff-b')`,
      )
    ).rows.map((row) => String(row.account))
    expect(accountsInDb.length).toBe(1)
    await assertCredentialsFileMatchesDbAndLogin(credentialsPath)
  })
})

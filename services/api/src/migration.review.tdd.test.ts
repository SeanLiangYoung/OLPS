import { randomBytes } from 'node:crypto'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { defaultSiteSettings, type SiteSettings } from '@olps/domain'
import { app } from './app.js'
import { legacySitesHaveTenantId, migrateToCollaborationModel } from './migrate.js'
import {
  initializeLegacySiteSandbox,
  stableDraftIdForLegacySite,
  type LegacyPageRow,
} from './migration-sandbox.js'
import { createFullLegacyTenantSchema, LEGACY_SETTINGS_JSON } from './test-support/legacy-schema.js'
import {
  createTestPool,
  getTestDatabaseUrl,
  resetTestDatabase,
  syncSearchPath,
} from './test-support/reset-test-db.js'
import { requestJson } from './test-support/http.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { appConfig } from './config.js'
import { resetTestSandboxes } from './test-support/reset-test-sandboxes.js'
import { hashPassword } from './password.js'

const SITE_A = '69f9cd6c-a6ce-4536-9e19-00b95dc05eb2'
const SITE_B = '8d0e28fd-706b-4da7-854f-176fdfe8c44f'

const apiPackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bootstrapUsersCli = path.join(apiPackageRoot, 'src', 'migration-bootstrap-users.ts')

function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`非法标识符: ${name}`)
  }
  return `"${name}"`
}

function parseDatabaseName(url: string): string {
  const parsed = new URL(url.replace(/^postgres:/, 'http:'))
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''))
}

function legacySiteSettings(): SiteSettings {
  return {
    ...defaultSiteSettings(appConfig.defaultScreenCap),
    ...(JSON.parse(LEGACY_SETTINGS_JSON) as SiteSettings),
  }
}

function setProductionShapeOwnersEnv(): void {
  process.env.MIGRATION_SITE_OWNERS = JSON.stringify({
    [SITE_A]: ['seanliang'],
    [SITE_B]: ['seanliang', 'test'],
  })
  process.env.MIGRATION_KB_OWNERS = JSON.stringify({
    'legacy-kb-1': ['seanliang'],
  })
}

function clearMigrationEnv(): void {
  delete process.env.MIGRATION_SITE_OWNERS
  delete process.env.MIGRATION_KB_OWNERS
  delete process.env.MIGRATION_BOOTSTRAP_USERS
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

async function createProductionShapeLegacy(pool: ReturnType<typeof createTestPool>): Promise<void> {
  await createFullLegacyTenantSchema(pool)
  await pool.query(`DELETE FROM analytics_events`)
  await pool.query(`DELETE FROM reports`)
  await pool.query(`DELETE FROM site_integrations`)
  await pool.query(`DELETE FROM jobs`)
  await pool.query(`DELETE FROM inquiry_email_outbox`)
  await pool.query(`DELETE FROM inquiries`)
  await pool.query(`DELETE FROM pages`)
  await pool.query(`DELETE FROM sites`)
  await pool.query(`DELETE FROM knowledge_documents`)
  await pool.query(`DELETE FROM knowledge_bases`)
  await pool.query(
    `INSERT INTO sites(site_id, tenant_id, name, settings, created_at, updated_at)
     VALUES ($1,'tenant-a','Site A',$3::jsonb,NOW(),NOW()),($2,'tenant-b','Site B',$3::jsonb,NOW(),NOW())`,
    [SITE_A, SITE_B, LEGACY_SETTINGS_JSON],
  )
  await pool.query(
    `INSERT INTO pages(
      page_id, site_id, tenant_id, kind, slug, title, status, locale, seo, body, created_at, updated_at, published_at
    ) VALUES
      ('page-a-home', $1, 'tenant-a', 'site', 'home', 'A Home', 'published', 'en',
       '{"title":"A Home","description":"A Home description"}'::jsonb,
       '{"html":"<h1>A</h1>"}'::jsonb, NOW(), NOW(), NOW()),
      ('page-b-home', $2, 'tenant-b', 'site', 'home', 'B Home', 'published', 'en',
       '{"title":"B Home","description":"B Home description"}'::jsonb,
       '{"html":"<h1>B</h1>"}'::jsonb, NOW(), NOW(), NOW())`,
    [SITE_A, SITE_B],
  )
  const siteIds = await pool.query(`SELECT site_id FROM sites ORDER BY site_id`)
  expect(siteIds.rows.map((r) => String(r.site_id))).toEqual([SITE_A, SITE_B].sort())
}

async function loginToken(account: string): Promise<string> {
  const login = await requestJson(app, 'POST', '/api/auth/login', {
    body: { account, password: 'migrate-review-pass' },
  })
  expect(login.status).toBe(200)
  return String((login.body as { accessToken: string }).accessToken)
}

async function createLimitedMigratorPool(mainPool: pg.Pool): Promise<{ pool: pg.Pool; role: string }> {
  const schema = process.env.PG_TEST_SCHEMA
  if (!schema) {
    throw new Error('测试缺少 PG_TEST_SCHEMA')
  }
  const url = getTestDatabaseUrl()
  const dbName = parseDatabaseName(url)
  const role = `migrator_${randomBytes(6).toString('hex')}`
  const password = `pw_${randomBytes(12).toString('hex')}`

  const admin = new pg.Pool(parsePoolConfigFromUrl(url))
  try {
    await admin.query(`CREATE ROLE ${quoteIdent(role)} WITH LOGIN PASSWORD '${password}'`)
    await admin.query(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(role)}`)
    await admin.query(`GRANT USAGE ON SCHEMA ${quoteIdent(schema)} TO ${quoteIdent(role)}`)
    await admin.query(`REVOKE CREATE ON SCHEMA ${quoteIdent(schema)} FROM ${quoteIdent(role)}`)

    const tables = await admin.query(`SELECT tablename FROM pg_tables WHERE schemaname = $1`, [schema])
    for (const row of tables.rows) {
      const table = String(row.tablename)
      await admin.query(
        `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} OWNER TO ${quoteIdent(role)}`,
      )
    }
  } finally {
    await admin.end()
  }

  const parsed = new URL(url.replace(/^postgres:/, 'http:'))
  const limitedPool = new pg.Pool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: dbName,
    user: role,
    password,
  })
  limitedPool.on('connect', (client) => {
    client.query(`SET search_path TO ${quoteIdent(schema)}`)
  })
  await syncSearchPath(limitedPool)

  const sitesOnMain = await mainPool.query(`SELECT COUNT(*)::int AS c FROM sites`)
  const sitesOnLimited = await limitedPool.query(`SELECT COUNT(*)::int AS c FROM sites`)
  expect(sitesOnLimited.rows[0]!.c).toBe(sitesOnMain.rows[0]!.c)

  return { pool: limitedPool, role }
}

async function dropMigratorRole(role: string): Promise<void> {
  const url = getTestDatabaseUrl()
  const admin = new pg.Pool(parsePoolConfigFromUrl(url))
  try {
    await admin.query(`REASSIGN OWNED BY ${quoteIdent(role)} TO CURRENT_USER`)
    await admin.query(`DROP OWNED BY ${quoteIdent(role)}`)
    await admin.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`)
  } finally {
    await admin.end()
  }
}

function parsePoolConfigFromUrl(url: string): pg.PoolConfig {
  const parsed = new URL(url.replace(/^postgres:/, 'http:'))
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  }
}

function runBootstrapUsersCli(extraEnv: Record<string, string>): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ['--import', 'tsx', bootstrapUsersCli], {
    cwd: apiPackageRoot,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  })
}

async function currentSchema(db: pg.Pool | pg.PoolClient): Promise<string> {
  const row = await db.query(`SELECT current_schema() AS s`)
  return String(row.rows[0]!.s)
}

const BORROWED_CONNECTION_COUNT = 3
const SEARCH_PATH_MARKER_SITE_ID = 'search-path-marker-new-7e2b'

async function borrowPoolClients(pool: pg.Pool, count: number): Promise<pg.PoolClient[]> {
  return Promise.all(Array.from({ length: count }, () => pool.connect()))
}

function releasePoolClients(clients: pg.PoolClient[]): void {
  for (const client of clients) {
    client.release()
  }
}

async function readBackendPid(client: pg.PoolClient): Promise<number> {
  const row = await client.query(`SELECT pg_backend_pid() AS pid`)
  return Number(row.rows[0]!.pid)
}

async function assertDistinctBackendPids(clients: pg.PoolClient[]): Promise<void> {
  const pids = await Promise.all(clients.map((c) => readBackendPid(c)))
  expect(new Set(pids).size).toBe(clients.length)
}

async function assertAllCurrentSchema(clients: pg.PoolClient[], expectedSchema: string): Promise<void> {
  const schemas = await Promise.all(clients.map((c) => currentSchema(c)))
  for (let index = 0; index < clients.length; index += 1) {
    expect(schemas[index], `连接 ${index + 1} current_schema`).toBe(expectedSchema)
  }
}

async function warmPoolIdleConnections(pool: pg.Pool, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const client = await pool.connect()
    await client.query(`SELECT 1`)
    client.release()
  }
}

async function insertSearchPathMarkerSite(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO sites(site_id, name, settings, created_at, updated_at)
     VALUES ($1, 'Search Path Marker', $2::jsonb, NOW(), NOW())`,
    [SEARCH_PATH_MARKER_SITE_ID, LEGACY_SETTINGS_JSON],
  )
}

async function assertClientsDoNotSeeLegacySite(clients: pg.PoolClient[]): Promise<void> {
  for (let index = 0; index < clients.length; index += 1) {
    const legacy = await clients[index]!.query(`SELECT site_id FROM sites WHERE site_id='legacy-site-1'`)
    expect(legacy.rowCount, `连接 ${index + 1} 不应读到 legacy-site-1`).toBe(0)
  }
}

async function assertClientsSeeMarkerSite(clients: pg.PoolClient[]): Promise<void> {
  for (let index = 0; index < clients.length; index += 1) {
    const marker = await clients[index]!.query(`SELECT site_id FROM sites WHERE site_id=$1`, [
      SEARCH_PATH_MARKER_SITE_ID,
    ])
    expect(marker.rowCount, `连接 ${index + 1} 应读到新 schema 标记站点`).toBe(1)
  }
}

const sharedTestPool = createTestPool()

afterAll(async () => {
  await sharedTestPool.end()
})

describe('测试库多连接 search_path', () => {
  const pool = sharedTestPool

  beforeEach(async () => {
    await resetTestDatabase()
    await resetTestSandboxes()
  })

  it('createTestPool 同时借出三个连接时 backend pid 互不相同且 current_schema 为当前 schema', async () => {
    await createFullLegacyTenantSchema(pool)
    const expectedSchema = process.env.PG_TEST_SCHEMA!

    const clients = await borrowPoolClients(pool, BORROWED_CONNECTION_COUNT)
    try {
      await assertDistinctBackendPids(clients)
      await assertAllCurrentSchema(clients, expectedSchema)
      const legacy = await clients[0]!.query(`SELECT site_id FROM sites WHERE site_id='legacy-site-1'`)
      expect(legacy.rowCount).toBe(1)
    } finally {
      releasePoolClients(clients)
    }
  })

  it('resetTestDatabase 切换 schema 后 test pool 同时借出的连接均应指向新 schema', async () => {
    await createFullLegacyTenantSchema(pool)
    await warmPoolIdleConnections(pool, BORROWED_CONNECTION_COUNT)

    const oldSchema = process.env.PG_TEST_SCHEMA!
    await resetTestDatabase()
    const newSchema = process.env.PG_TEST_SCHEMA!
    expect(newSchema).not.toBe(oldSchema)

    await insertSearchPathMarkerSite(pool)

    const clients = await borrowPoolClients(pool, BORROWED_CONNECTION_COUNT)
    try {
      await assertDistinctBackendPids(clients)
      await assertAllCurrentSchema(clients, newSchema)
      await assertClientsDoNotSeeLegacySite(clients)
      await assertClientsSeeMarkerSite(clients)
    } finally {
      releasePoolClients(clients)
    }
  })

  it('resetTestDatabase 切换 schema 后 app pool 同时借出的连接均应指向新 schema', async () => {
    await createFullLegacyTenantSchema(pool)
    await warmPoolIdleConnections(pool, BORROWED_CONNECTION_COUNT)

    const { pool: appPool } = await import('./db.js')
    await warmPoolIdleConnections(appPool, BORROWED_CONNECTION_COUNT)

    const oldSchema = process.env.PG_TEST_SCHEMA!
    await resetTestDatabase()
    const newSchema = process.env.PG_TEST_SCHEMA!
    expect(newSchema).not.toBe(oldSchema)

    await insertSearchPathMarkerSite(pool)

    const clients = await borrowPoolClients(appPool, BORROWED_CONNECTION_COUNT)
    try {
      await assertDistinctBackendPids(clients)
      await assertAllCurrentSchema(clients, newSchema)
      await assertClientsDoNotSeeLegacySite(clients)
      await assertClientsSeeMarkerSite(clients)
    } finally {
      releasePoolClients(clients)
    }
  })
})

describe('迁移复审 TDD（六项，预期失败直至实现）', () => {
  const pool = sharedTestPool

  beforeEach(async () => {
    clearMigrationEnv()
    await resetTestDatabase()
    await resetTestSandboxes()
  })

  it('复审1a：DROP legacy 后缺少 schema CREATE 权限时失败且 legacy 行数不变', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    process.env.MIGRATION_SITE_OWNERS = JSON.stringify({ 'legacy-site-1': ['seanliang'] })
    process.env.MIGRATION_KB_OWNERS = JSON.stringify({ 'legacy-kb-1': ['seanliang'] })

    const sitesBefore = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM sites`)).rows[0]!.c)
    const pagesBefore = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM pages`)).rows[0]!.c)
    const inquiriesBefore = Number(
      (await pool.query(`SELECT COUNT(*)::int AS c FROM inquiries`)).rows[0]!.c,
    )

    const { pool: limitedPool, role } = await createLimitedMigratorPool(pool)
    await expect(migrateToCollaborationModel(limitedPool)).rejects.toThrow(
      /permission denied|42501|CREATE|schema|权限/i,
    )

    expect(await legacySitesHaveTenantId(pool)).toBe(true)
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS c FROM sites`)).rows[0]!.c)).toBe(
      sitesBefore,
    )
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS c FROM pages`)).rows[0]!.c)).toBe(
      pagesBefore,
    )
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS c FROM inquiries`)).rows[0]!.c)).toBe(
      inquiriesBefore,
    )

    await limitedPool.end()
    await dropMigratorRole(role)
  })

  it('复审1b：sandbox 构建失败时 legacy 库未被 DDL 事务改写', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    process.env.MIGRATION_SITE_OWNERS = JSON.stringify({ 'legacy-site-1': ['seanliang'] })
    process.env.MIGRATION_KB_OWNERS = JSON.stringify({ 'legacy-kb-1': ['seanliang'] })
    await pool.query(`
      UPDATE pages SET seo='{}'::jsonb WHERE page_id='legacy-page-home'
    `)
    const pagesBefore = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM pages`)).rows[0]!.c)
    await expect(migrateToCollaborationModel(pool)).rejects.toThrow(/sandbox|构建|seo|校验/)
    expect(await legacySitesHaveTenantId(pool)).toBe(true)
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS c FROM pages`)).rows[0]!.c)).toBe(
      pagesBefore,
    )
  })

  it('复审2a：legacy 仍在且 sandbox 缺页时 migrate 拒绝且不得当作完成目录', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    process.env.MIGRATION_SITE_OWNERS = JSON.stringify({ 'legacy-site-1': ['seanliang'] })
    process.env.MIGRATION_KB_OWNERS = JSON.stringify({ 'legacy-kb-1': ['seanliang'] })

    const legacySiteId = 'legacy-site-1'
    const draftId = stableDraftIdForLegacySite(legacySiteId)
    const pageRows = await pool.query(`SELECT * FROM pages WHERE site_id=$1 ORDER BY page_id`, [
      legacySiteId,
    ])
    const homeOnly = pageRows.rows.filter((r) => String(r.page_id) === 'legacy-page-home') as LegacyPageRow[]

    await initializeLegacySiteSandbox({
      legacySiteId,
      draftId,
      sandboxId: draftId,
      pendingSiteId: legacySiteId,
      siteName: 'Legacy Site',
      settings: legacySiteSettings(),
      pages: homeOnly,
      skipIfPresent: false,
    })

    await expect(migrateToCollaborationModel(pool)).rejects.toThrow(
      /sandbox|不一致|页面|指纹|输入|缺|不完整/,
    )
    expect(await legacySitesHaveTenantId(pool)).toBe(true)
  })

  it('复审2b：迁移完成后再次调用保持幂等，不因用户编辑 sandbox 而失败', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    process.env.MIGRATION_SITE_OWNERS = JSON.stringify({ 'legacy-site-1': ['seanliang'] })
    process.env.MIGRATION_KB_OWNERS = JSON.stringify({ 'legacy-kb-1': ['seanliang'] })

    await migrateToCollaborationModel(pool)
    expect(await legacySitesHaveTenantId(pool)).toBe(false)

    const draftId = stableDraftIdForLegacySite('legacy-site-1')
    await fs.rm(`${appConfig.sandboxRoot}/${draftId}`, { force: true, recursive: true })

    await expect(migrateToCollaborationModel(pool)).resolves.toBeUndefined()
  })

  it('复审3：未发布历史询盘 site_id 为空，draft 历史 HTTP 可读写', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    process.env.MIGRATION_SITE_OWNERS = JSON.stringify({ 'legacy-site-1': ['seanliang'] })
    process.env.MIGRATION_KB_OWNERS = JSON.stringify({ 'legacy-kb-1': ['seanliang'] })
    await migrateToCollaborationModel(pool)
    const draftId = stableDraftIdForLegacySite('legacy-site-1')
    const inq = await pool.query(`SELECT inquiry_id, site_id, draft_id FROM inquiries LIMIT 1`)
    expect(inq.rowCount).toBe(1)
    expect(inq.rows[0]!.site_id).toBeNull()
    expect(String(inq.rows[0]!.draft_id)).toBe(draftId)

    const token = await loginToken('seanliang')
    const list = await requestJson(app, 'GET', `/api/drafts/${draftId}/inquiries`, { token })
    expect(list.status).toBe(200)
    const inquiries = list.body.inquiries as Array<Record<string, unknown>>
    expect(inquiries.length).toBe(1)

    const patch = await requestJson(app, 'PATCH', `/api/inquiries/${inq.rows[0]!.inquiry_id}`, {
      token,
      body: { status: 'processing' },
    })
    expect(patch.status).toBe(200)
  })

  it('复审4：两站点 seanliang 独占与 seanliang+test 共享所有者', async () => {
    requireRemoteServiceConfig()
    await createProductionShapeLegacy(pool)
    await seedUsers(pool)
    setProductionShapeOwnersEnv()
    process.env.MIGRATION_KB_OWNERS = JSON.stringify({ 'legacy-kb-1': ['seanliang'] })
    await pool.query(`
      INSERT INTO knowledge_bases(kb_id, tenant_id, name, created_at, updated_at)
      VALUES ('legacy-kb-1', 'tenant-a', 'KB A', NOW(), NOW()) ON CONFLICT DO NOTHING
    `)

    const legacySiteIds = (
      await pool.query(`SELECT site_id FROM sites ORDER BY site_id`)
    ).rows.map((r) => String(r.site_id))
    expect(legacySiteIds).toEqual([SITE_A, SITE_B].sort())
    expect(legacySiteIds).not.toContain('legacy-site-1')

    await migrateToCollaborationModel(pool)
    const draftA = stableDraftIdForLegacySite(SITE_A)
    const draftB = stableDraftIdForLegacySite(SITE_B)
    const ownersA = await pool.query(
      `SELECT u.account FROM draft_owners o JOIN users u ON u.user_id=o.user_id WHERE o.draft_id=$1 ORDER BY u.account`,
      [draftA],
    )
    const ownersB = await pool.query(
      `SELECT u.account FROM draft_owners o JOIN users u ON u.user_id=o.user_id WHERE o.draft_id=$1 ORDER BY u.account`,
      [draftB],
    )
    expect(ownersA.rows.map((r) => String(r.account))).toEqual(['seanliang'])
    expect(ownersB.rows.map((r) => String(r.account))).toEqual(['seanliang', 'test'])
  })

  it('复审5：迁移后 jobs/reports/integrations/analytics/outbox 字段与 legacy 快照逐项一致', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    process.env.MIGRATION_SITE_OWNERS = JSON.stringify({ 'legacy-site-1': ['seanliang'] })
    process.env.MIGRATION_KB_OWNERS = JSON.stringify({ 'legacy-kb-1': ['seanliang'] })

    const legacyJob = (await pool.query(`SELECT * FROM jobs WHERE job_id='legacy-job-1'`)).rows[0]!
    const legacyReport = (await pool.query(`SELECT * FROM reports WHERE report_id='legacy-report-1'`)).rows[0]!
    const legacyInt = (await pool.query(`SELECT * FROM site_integrations WHERE site_id='legacy-site-1'`)).rows[0]!
    const legacyEv = (await pool.query(`SELECT * FROM analytics_events WHERE name='page_view'`)).rows[0]!
    const legacyOut = (await pool.query(`SELECT * FROM inquiry_email_outbox WHERE outbox_id=1`)).rows[0]!

    await migrateToCollaborationModel(pool)

    const job = (await pool.query(`SELECT * FROM jobs WHERE job_id='legacy-job-1'`)).rows[0]!
    expect(String(job.type)).toBe(String(legacyJob.type))
    expect(String(job.status)).toBe(String(legacyJob.status))
    expect(job.request).toEqual(legacyJob.request)
    expect(new Date(String(job.created_at)).toISOString()).toBe(
      new Date(String(legacyJob.created_at)).toISOString(),
    )

    const report = (await pool.query(`SELECT * FROM reports WHERE report_id='legacy-report-1'`)).rows[0]!
    expect(Number(report.score)).toBe(Number(legacyReport.score))
    expect(report.checklist).toEqual(legacyReport.checklist)
    expect(String(report.page_id)).toBe(String(legacyReport.page_id))
    expect(report.site_id).toBeNull()

    const intRow = await pool.query(`SELECT * FROM site_integrations WHERE draft_id=$1`, [
      stableDraftIdForLegacySite('legacy-site-1'),
    ])
    expect(intRow.rowCount).toBe(1)
    expect(Boolean(intRow.rows[0]!.ads_connected)).toBe(Boolean(legacyInt.ads_connected))
    expect(intRow.rows[0]!.site_id).toBeNull()

    const ev = (await pool.query(`SELECT * FROM analytics_events WHERE event_id=$1`, [legacyEv.event_id]))
      .rows[0]!
    expect(String(ev.name)).toBe(String(legacyEv.name))
    expect(ev.payload).toEqual(legacyEv.payload)
    expect(ev.site_id).toBeNull()

    const out = (await pool.query(`SELECT * FROM inquiry_email_outbox WHERE outbox_id=1`)).rows[0]!
    expect(out.payload).toEqual(legacyOut.payload)
    expect(out.site_id).toBeNull()

    const nextInq = await pool.query(
      `SELECT nextval(pg_get_serial_sequence('inquiries','inquiry_id')) AS n`,
    )
    expect(Number(nextInq.rows[0]!.n)).toBeGreaterThan(1)
  })

  it('复审6a：bootstrap-users CLI 在无 users 表时按配置写入账号', async () => {
    await createFullLegacyTenantSchema(pool)
    const sessionsBefore = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema=current_schema() AND table_name='sessions'`,
    )
    expect(sessionsBefore.rowCount).toBe(0)

    const credentialsPath = path.join(
      apiPackageRoot,
      '.intermediate',
      `migration-bootstrap-creds-${randomBytes(8).toString('hex')}.json`,
    )
    await fs.mkdir(path.dirname(credentialsPath), { recursive: true })

    const run = runBootstrapUsersCli({
      MIGRATION_BOOTSTRAP_CREDENTIALS_PATH: credentialsPath,
      MIGRATION_BOOTSTRAP_USERS: JSON.stringify([{ account: 'seanliang', name: 'Sean' }]),
    })

    expect(run.error, `进程启动失败: ${run.error?.message ?? ''}`).toBeUndefined()
    const output = `${run.stdout}\n${run.stderr}`
    expect(run.status, output).toBe(0)

    const users = await pool.query(`SELECT account, name, password_hash FROM users WHERE account='seanliang'`)
    expect(users.rowCount).toBe(1)
    expect(String(users.rows[0]!.name)).toBe('Sean')

    const credentialsRaw = await fs.readFile(credentialsPath, 'utf8')
    const credentials = JSON.parse(credentialsRaw) as Record<string, { password: string }>
    expect(credentials.seanliang?.password.length).toBeGreaterThan(16)
    expect(output).not.toContain(credentials.seanliang.password)

    requireRemoteServiceConfig()
    process.env.MIGRATION_SITE_OWNERS = JSON.stringify({ 'legacy-site-1': ['seanliang'] })
    process.env.MIGRATION_KB_OWNERS = JSON.stringify({ 'legacy-kb-1': ['seanliang'] })
    await migrateToCollaborationModel(pool)

    const login = await requestJson(app, 'POST', '/api/auth/login', {
      body: { account: 'seanliang', password: credentials.seanliang.password },
    })
    expect(login.status).toBe(200)
  })

  it('复审6b：无 users 表时 migrate 预检提示 bootstrap-users，且不删除 legacy', async () => {
    await createFullLegacyTenantSchema(pool)
    process.env.MIGRATION_SITE_OWNERS = JSON.stringify({ 'legacy-site-1': ['seanliang'] })
    process.env.MIGRATION_KB_OWNERS = JSON.stringify({ 'legacy-kb-1': ['seanliang'] })
    await expect(migrateToCollaborationModel(pool)).rejects.toThrow(/users 表|bootstrap-users/)
    expect(await legacySitesHaveTenantId(pool)).toBe(true)
  })
})

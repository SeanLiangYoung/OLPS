import type pg from 'pg'
import { createHash } from 'node:crypto'
import { appConfig } from './config.js'
import { migrateWithClient } from './db.js'
import {
  initializeLegacySiteSandbox,
  stableDraftIdForLegacySite,
  type LegacyPageRow,
} from './cms-legacy-sandbox.js'

export async function legacySitesHaveTenantId(pool: pg.Pool): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name='sites' AND column_name='tenant_id'`,
  )
  return (result.rowCount ?? 0) > 0
}

type SiteOwnersMap = Record<string, string[]>
type KbOwnersMap = Record<string, string[]>

export const LEGACY_MIGRATION_LOCK_TABLES: readonly string[] = [
  'analytics_events',
  'inquiry_email_outbox',
  'inquiries',
  'jobs',
  'knowledge_bases',
  'knowledge_documents',
  'pages',
  'reports',
  'site_integrations',
  'sites',
]

const DROP_LEGACY_TABLES: string[] = [
  `DROP TABLE IF EXISTS analytics_events CASCADE`,
  `DROP TABLE IF EXISTS reports CASCADE`,
  `DROP TABLE IF EXISTS site_integrations CASCADE`,
  `DROP TABLE IF EXISTS jobs CASCADE`,
  `DROP TABLE IF EXISTS knowledge_documents CASCADE`,
  `DROP TABLE IF EXISTS knowledge_bases CASCADE`,
  `DROP TABLE IF EXISTS inquiry_email_outbox CASCADE`,
  `DROP TABLE IF EXISTS inquiries CASCADE`,
  `DROP TABLE IF EXISTS pages CASCADE`,
  `DROP TABLE IF EXISTS sites CASCADE`,
]

async function lockLegacyMigrationTables(client: pg.PoolClient): Promise<void> {
  for (const table of LEGACY_MIGRATION_LOCK_TABLES) {
    await client.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`)
  }
}

function parseJsonEnv(name: string): Record<string, unknown> {
  const raw = process.env[name]?.trim()
  if (!raw) {
    throw new Error(`${name}: 缺少迁移所有权映射配置`)
  }
  return JSON.parse(raw) as Record<string, unknown>
}

function parseSiteOwnersMap(): SiteOwnersMap {
  const parsed = parseJsonEnv('MIGRATION_SITE_OWNERS')
  const out: SiteOwnersMap = {}
  for (const [siteId, owners] of Object.entries(parsed)) {
    if (!Array.isArray(owners) || owners.some((o) => typeof o !== 'string')) {
      throw new Error(`MIGRATION_SITE_OWNERS: 站点 ${siteId} 的所有者必须是账号字符串数组`)
    }
    out[siteId] = owners
  }
  return out
}

function parseKbOwnersMap(): KbOwnersMap {
  const raw = process.env.MIGRATION_KB_OWNERS?.trim()
  if (!raw) {
    return {}
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const out: KbOwnersMap = {}
  for (const [kbId, owners] of Object.entries(parsed)) {
    if (!Array.isArray(owners) || owners.some((o) => typeof o !== 'string')) {
      throw new Error(`MIGRATION_KB_OWNERS: 知识库 ${kbId} 的所有者必须是账号字符串数组`)
    }
    out[kbId] = owners
  }
  return out
}

async function assertMigrationUsersReady(client: pg.PoolClient): Promise<void> {
  const table = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'users'`,
  )
  if (!(table.rowCount ?? 0)) {
    throw new Error('迁移预检失败: 缺少 users 表，请先运行 bootstrap-users 初始化本地账号')
  }
}

async function resolveAccountUserIds(
  client: pg.PoolClient,
  accounts: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(accounts)]
  const map = new Map<string, string>()
  for (const account of unique) {
    const row = await client.query(`SELECT user_id FROM users WHERE account=$1`, [account])
    if (!row.rowCount) {
      throw new Error(
        `迁移预检失败: 本地用户不存在 account=${account}，请先运行 bootstrap-users 补齐账号`,
      )
    }
    map.set(account, String(row.rows[0]!.user_id))
  }
  return map
}

function mergeSiteSettings(raw: unknown): Record<string,unknown> {
  return { defaultLocale:'en',locales:['en'],analyticsEnabled:true,mapsEnabled:false,mapsApiKey:'',whatsappEnabled:false,whatsappNumber:'',whatsappLabel:'Chat on WhatsApp',...(raw as Record<string,unknown>) }
}

const MIGRATION_SERIAL_COLUMNS = [
  { table: 'inquiries', column: 'inquiry_id' },
  { table: 'inquiry_email_outbox', column: 'outbox_id' },
  { table: 'analytics_events', column: 'event_id' },
] as const

type MigrationSerialSnapshot = {
  table: string
  column: string
  lastValue: string
  isCalled: boolean
}

async function readSerialSequenceState(
  client: pg.PoolClient,
  table: string,
  column: string,
): Promise<MigrationSerialSnapshot> {
  const seqResult = await client.query(`SELECT pg_get_serial_sequence($1, $2) AS seq`, [table, column])
  const seqRegclass = seqResult.rows[0]?.seq as string | null
  if (!seqRegclass) {
    throw new Error(`迁移序列快照失败: 表 ${table} 列 ${column} 无 serial 序列`)
  }
  if (!/^[\w."]+$/.test(seqRegclass)) {
    throw new Error(`迁移序列快照失败: 非法序列名 ${seqRegclass}`)
  }
  const state = await client.query(`SELECT last_value, is_called FROM ${seqRegclass}`)
  if (!(state.rowCount ?? 0)) {
    throw new Error(`迁移序列快照失败: 无法读取序列 ${seqRegclass}`)
  }
  return {
    table,
    column,
    lastValue: String(state.rows[0]!.last_value),
    isCalled: Boolean(state.rows[0]!.is_called),
  }
}

async function captureMigrationSerialSnapshots(client: pg.PoolClient): Promise<MigrationSerialSnapshot[]> {
  const snapshots: MigrationSerialSnapshot[] = []
  for (const spec of MIGRATION_SERIAL_COLUMNS) {
    snapshots.push(await readSerialSequenceState(client, spec.table, spec.column))
  }
  return snapshots
}

async function restoreMigrationSerialSnapshots(
  client: pg.PoolClient,
  snapshots: MigrationSerialSnapshot[],
): Promise<void> {
  for (const snap of snapshots) {
    const seqResult = await client.query(`SELECT pg_get_serial_sequence($1, $2) AS seq`, [
      snap.table,
      snap.column,
    ])
    const seqRegclass = seqResult.rows[0]?.seq as string | null
    if (!seqRegclass) {
      throw new Error(`迁移序列恢复失败: 表 ${snap.table} 列 ${snap.column} 无 serial 序列`)
    }
    await client.query(`SELECT setval($1::regclass, $2::bigint, $3::boolean)`, [
      seqRegclass,
      snap.lastValue,
      snap.isCalled,
    ])
  }
}

export async function migrateToCollaborationModel(pool: pg.Pool,options:{sandboxRoot?:string}={}): Promise<void> {
  const isLegacy = await legacySitesHaveTenantId(pool)
  if (!isLegacy) {
    return
  }

  const siteOwnersMap = parseSiteOwnersMap()
  const kbOwnersMap = parseKbOwnersMap()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    try {
      await lockLegacyMigrationTables(client)

    const legacySites = await client.query(`SELECT * FROM sites ORDER BY created_at`)
    const legacyPages = await client.query(`SELECT * FROM pages ORDER BY created_at`)
    const legacyKb = await client.query(`SELECT * FROM knowledge_bases ORDER BY created_at`)
    const legacyDocs = await client.query(`SELECT * FROM knowledge_documents ORDER BY created_at`)
    const legacyInquiries = await client.query(`SELECT * FROM inquiries ORDER BY inquiry_id`)
    const legacyOutbox = await client.query(`SELECT * FROM inquiry_email_outbox ORDER BY outbox_id`)
    const legacyJobs = await client.query(`SELECT * FROM jobs ORDER BY created_at`)
    const legacyIntegrations = await client.query(`SELECT * FROM site_integrations ORDER BY site_id`)
    const legacyReports = await client.query(`SELECT * FROM reports ORDER BY created_at`)
    const legacyAnalytics = await client.query(`SELECT * FROM analytics_events ORDER BY event_id`)

    const allAccounts: string[] = []
    for (const siteRow of legacySites.rows) {
      const legacySiteId = String(siteRow.site_id)
      const owners = siteOwnersMap[legacySiteId]
      if (!owners?.length) {
        throw new Error(`MIGRATION_SITE_OWNERS: 缺少 legacy site ${legacySiteId} 的所有者映射`)
      }
      allAccounts.push(...owners)
    }
    for (const kbRow of legacyKb.rows) {
      const kbId = String(kbRow.kb_id)
      const owners = kbOwnersMap[kbId]
      if (!owners?.length) {
        throw new Error(`MIGRATION_KB_OWNERS: 缺少 knowledge base ${kbId} 的所有者映射`)
      }
      allAccounts.push(...owners)
    }

    await assertMigrationUsersReady(client)
    const accountToUserId = await resolveAccountUserIds(client, allAccounts)

    const siteDraftPlan = legacySites.rows.map((siteRow) => {
      const legacySiteId = String(siteRow.site_id)
      const draftId = stableDraftIdForLegacySite(legacySiteId)
      const sandboxId = draftId
      const pendingSiteId = legacySiteId
      const ownerUserIds = siteOwnersMap[legacySiteId]!.map((a) => accountToUserId.get(a)!)
      const pages = legacyPages.rows.filter((p) => String(p.site_id) === legacySiteId) as LegacyPageRow[]
      return {
        legacySiteId,
        draftId,
        sandboxId,
        pendingSiteId,
        siteName: String(siteRow.name),
        settings: mergeSiteSettings(siteRow.settings),
        pages,
        ownerUserIds,
        createdAt: siteRow.created_at as Date,
        updatedAt: siteRow.updated_at as Date,
      }
    })

    const draftIdByLegacySite = new Map(siteDraftPlan.map((p) => [p.legacySiteId, p.draftId]))

    for (const pageRow of legacyPages.rows) {
      const siteId = String(pageRow.site_id)
      if (!draftIdByLegacySite.has(siteId)) {
        throw new Error(`迁移预检失败: 页面 ${pageRow.page_id} 引用未知站点 ${siteId}`)
      }
    }
    for (const inqRow of legacyInquiries.rows) {
      const siteId = String(inqRow.site_id)
      if (!draftIdByLegacySite.has(siteId)) {
        throw new Error(`迁移预检失败: 询盘 ${inqRow.inquiry_id} 引用未知站点 ${siteId}`)
      }
    }
    for (const jobRow of legacyJobs.rows) {
      const siteId = String(jobRow.site_id)
      if (!draftIdByLegacySite.has(siteId)) {
        throw new Error(`迁移预检失败: 任务 ${jobRow.job_id} 引用未知站点 ${siteId}`)
      }
    }
    for (const intRow of legacyIntegrations.rows) {
      const siteId = String(intRow.site_id)
      if (!draftIdByLegacySite.has(siteId)) {
        throw new Error(`迁移预检失败: integrations ${siteId} 无对应 legacy 站点`)
      }
    }
    for (const repRow of legacyReports.rows) {
      const siteId = String(repRow.site_id)
      if (!draftIdByLegacySite.has(siteId)) {
        throw new Error(`迁移预检失败: 报告 ${repRow.report_id} 引用未知站点 ${siteId}`)
      }
    }
    for (const evRow of legacyAnalytics.rows) {
      const siteId = String(evRow.site_id)
      if (!draftIdByLegacySite.has(siteId)) {
        throw new Error(`迁移预检失败: 分析事件 ${evRow.event_id} 引用未知站点 ${siteId}`)
      }
    }
    for (const docRow of legacyDocs.rows) {
      const kbId = String(docRow.kb_id)
      const kb = legacyKb.rows.find((k) => String(k.kb_id) === kbId)
      if (!kb) {
        throw new Error(`迁移预检失败: 文档 ${docRow.doc_id} 引用未知知识库 ${kbId}`)
      }
    }

    const migrationSerialSnapshots = await captureMigrationSerialSnapshots(client)

    const sandboxCommits: Array<{
      legacySiteId: string
      draftId: string
      headCommitId: string
      baseCommitId: string | null
    }> = []
    for (const plan of siteDraftPlan) {
      const commit = await initializeLegacySiteSandbox({
        legacySiteId: plan.legacySiteId,
        draftId: plan.draftId,
        sandboxId: plan.sandboxId,
        pendingSiteId: plan.pendingSiteId,
        siteName: plan.siteName,
        settings: plan.settings,
        pages: plan.pages,
        skipIfPresent: true,
      },options.sandboxRoot)
      sandboxCommits.push({
        legacySiteId: plan.legacySiteId,
        draftId: plan.draftId,
        headCommitId: commit.headCommitId,
        baseCommitId: commit.baseCommitId,
      })
    }

      for (const sql of DROP_LEGACY_TABLES) {
        await client.query(sql)
      }
      await client.query(`DROP TABLE IF EXISTS draft_owners CASCADE`)
      await client.query(`DROP TABLE IF EXISTS site_drafts CASCADE`)
      await client.query(`DROP TABLE IF EXISTS site_owners CASCADE`)
      await client.query(`DROP TABLE IF EXISTS sessions CASCADE`)
      await client.query(`DROP TABLE IF EXISTS migration_legacy_site_map CASCADE`)

      await migrateWithClient(client)

      for (const plan of siteDraftPlan) {
        const commit = sandboxCommits.find((c) => c.draftId === plan.draftId)!
        await client.query(
          `INSERT INTO site_drafts(
            draft_id, site_id, name, sandbox_id, pending_site_id, base_commit_id, head_commit_id,
            status, init_status, sync_status, created_at, updated_at
          ) VALUES ($1,NULL,$2,$3,$4,$5,$6,'active','ready','clean',$7,$8)`,
          [
            plan.draftId,
            plan.siteName,
            plan.sandboxId,
            plan.pendingSiteId,
            commit.baseCommitId,
            commit.headCommitId,
            plan.createdAt,
            plan.updatedAt,
          ],
        )
        for (const ownerUserId of plan.ownerUserIds) {
          await client.query(
            `INSERT INTO draft_owners(draft_id, user_id, created_at) VALUES ($1,$2,$3)`,
            [plan.draftId, ownerUserId, plan.createdAt],
          )
        }
        for (const pageRow of plan.pages) {
          await client.query(
            `INSERT INTO pages(
              draft_id, page_id, site_id, kind, slug, title, status, locale, seo, body,
              created_at, updated_at, published_at
            ) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
            [
              plan.draftId,
              String(pageRow.page_id),
              String(pageRow.kind),
              String(pageRow.slug),
              String(pageRow.title),
              String(pageRow.status),
              String(pageRow.locale),
              JSON.stringify(pageRow.seo),
              JSON.stringify(pageRow.body),
              pageRow.created_at,
              pageRow.updated_at,
              pageRow.published_at,
            ],
          )
        }
        await client.query(
          `INSERT INTO migration_legacy_site_map(legacy_site_id, draft_id, sandbox_id, migrated_at)
           VALUES ($1,$2,$3,NOW())`,
          [plan.legacySiteId, plan.draftId, plan.sandboxId],
        )
      }

      for (const kbRow of legacyKb.rows) {
        const kbId = String(kbRow.kb_id)
        const ownerAccounts = kbOwnersMap[kbId]!
        const ownerUserId = accountToUserId.get(ownerAccounts[0]!)!
        await client.query(
          `INSERT INTO knowledge_bases(kb_id, owner_user_id, name, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [kbId, ownerUserId, String(kbRow.name), kbRow.created_at, kbRow.updated_at],
        )
        for (const account of ownerAccounts) {
          const uid = accountToUserId.get(account)!
          if (uid === ownerUserId) {
            continue
          }
          await client.query(
            `INSERT INTO knowledge_base_grants(kb_id, user_id, created_at) VALUES ($1,$2,$3)
             ON CONFLICT DO NOTHING`,
            [kbId, uid, kbRow.created_at],
          )
        }
      }

      for (const docRow of legacyDocs.rows) {
        await client.query(
          `INSERT INTO knowledge_documents(doc_id, kb_id, title, content, created_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            String(docRow.doc_id),
            String(docRow.kb_id),
            String(docRow.title),
            String(docRow.content),
            docRow.created_at,
          ],
        )
      }

      for (const inqRow of legacyInquiries.rows) {
        const legacySiteId = String(inqRow.site_id)
        const draftId = draftIdByLegacySite.get(legacySiteId)!
        await client.query(
          `INSERT INTO inquiries(
            inquiry_id, draft_id, site_id, page_id, payload, status, created_at, updated_at
          ) VALUES ($1,$2,NULL,$3,$4::jsonb,$5,$6,$7)`,
          [
            Number(inqRow.inquiry_id),
            draftId,
            inqRow.page_id ? String(inqRow.page_id) : null,
            JSON.stringify(inqRow.payload),
            String(inqRow.status ?? 'new'),
            inqRow.created_at,
            inqRow.updated_at,
          ],
        )
      }

      for (const outRow of legacyOutbox.rows) {
        const inq = legacyInquiries.rows.find(
          (r) => Number(r.inquiry_id) === Number(outRow.inquiry_id),
        )
        if (!inq) {
          throw new Error(`迁移预检失败: outbox ${outRow.outbox_id} 缺少询盘`)
        }
        await client.query(
          `INSERT INTO inquiry_email_outbox(outbox_id, inquiry_id, site_id, payload, created_at)
           VALUES ($1,$2,NULL,$3::jsonb,$4)`,
          [
            Number(outRow.outbox_id),
            Number(outRow.inquiry_id),
            JSON.stringify(outRow.payload),
            outRow.created_at,
          ],
        )
      }

      for (const jobRow of legacyJobs.rows) {
        const legacySiteId = String(jobRow.site_id)
        const draftId = draftIdByLegacySite.get(legacySiteId)!
        const ownerUserId = siteDraftPlan.find((p) => p.legacySiteId === legacySiteId)!.ownerUserIds[0]!
        await client.query(
          `INSERT INTO jobs(
            job_id, user_id, draft_id, site_id, type, status, request, result, error, created_at, updated_at
          ) VALUES ($1,$2,$3,NULL,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)`,
          [
            String(jobRow.job_id),
            ownerUserId,
            draftId,
            String(jobRow.type),
            String(jobRow.status),
            JSON.stringify(jobRow.request),
            jobRow.result ? JSON.stringify(jobRow.result) : null,
            jobRow.error ? String(jobRow.error) : null,
            jobRow.created_at,
            jobRow.updated_at,
          ],
        )
      }

      for (const intRow of legacyIntegrations.rows) {
        const legacySiteId = String(intRow.site_id)
        const draftId = draftIdByLegacySite.get(legacySiteId)!
        await client.query(
          `INSERT INTO site_integrations(
            draft_id, site_id, ads_account_id, ads_connected, ga_property_id, ga_connected, updated_at
          ) VALUES ($1,NULL,$2,$3,$4,$5,$6)`,
          [
            draftId,
            String(intRow.ads_account_id),
            Boolean(intRow.ads_connected),
            String(intRow.ga_property_id),
            Boolean(intRow.ga_connected),
            intRow.updated_at,
          ],
        )
      }

      for (const repRow of legacyReports.rows) {
        const legacySiteId = String(repRow.site_id)
        const draftId = draftIdByLegacySite.get(legacySiteId)!
        const ownerUserId = siteDraftPlan.find((p) => p.legacySiteId === legacySiteId)!.ownerUserIds[0]!
        await client.query(
          `INSERT INTO reports(report_id, user_id, site_id, draft_id, page_id, score, checklist, created_at)
           VALUES ($1,$2,NULL,$3,$4,$5,$6::jsonb,$7)`,
          [
            String(repRow.report_id),
            ownerUserId,
            draftId,
            String(repRow.page_id),
            Number(repRow.score),
            JSON.stringify(repRow.checklist),
            repRow.created_at,
          ],
        )
      }

      for (const evRow of legacyAnalytics.rows) {
        const legacySiteId = String(evRow.site_id)
        const draftId = draftIdByLegacySite.get(legacySiteId)!
        await client.query(
          `INSERT INTO analytics_events(
            event_id, draft_id, site_id, page_id, name, payload, created_at
          ) VALUES ($1,$2,NULL,$3,$4,$5::jsonb,$6)`,
          [
            Number(evRow.event_id),
            draftId,
            evRow.page_id ? String(evRow.page_id) : null,
            String(evRow.name),
            JSON.stringify(evRow.payload),
            evRow.created_at,
          ],
        )
      }

      await restoreMigrationSerialSnapshots(client, migrationSerialSnapshots)

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  } finally {
    client.release()
  }
}

export function migrationFingerprint(legacySiteId: string): string {
  return createHash('sha256').update(stableDraftIdForLegacySite(legacySiteId)).digest('hex')
}

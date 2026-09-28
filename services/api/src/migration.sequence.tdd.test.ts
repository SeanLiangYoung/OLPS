import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { migrateToCollaborationModel } from './migrate.js'
import { stableDraftIdForLegacySite } from './migration-sandbox.js'
import { createFullLegacyTenantSchema } from './test-support/legacy-schema.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { resetTestSandboxes } from './test-support/reset-test-sandboxes.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { hashPassword } from './password.js'

const LEGACY_SITE = 'legacy-site-1'

const MIGRATION_SERIALS = [
  'inquiries_inquiry_id_seq',
  'inquiry_email_outbox_outbox_id_seq',
  'analytics_events_event_id_seq',
] as const

type SerialState = {
  last_value: string
  is_called: boolean
}

function clearMigrationEnv(): void {
  delete process.env.MIGRATION_SITE_OWNERS
  delete process.env.MIGRATION_KB_OWNERS
}

function setLegacyMigrationEnv(): void {
  process.env.MIGRATION_SITE_OWNERS = JSON.stringify({ [LEGACY_SITE]: ['seanliang'] })
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
  await pool.query(
    `INSERT INTO users(user_id, account, password_hash, name, created_at, updated_at)
     VALUES ('user-sean','seanliang',$1,'Sean',$2,$2) ON CONFLICT (user_id) DO NOTHING`,
    [hashPassword('migrate-review-pass'), now],
  )
}

async function readSerialState(
  pool: ReturnType<typeof createTestPool>,
  seqName: (typeof MIGRATION_SERIALS)[number],
): Promise<SerialState> {
  const row = (await pool.query(`SELECT last_value, is_called FROM ${seqName}`)).rows[0]!
  return {
    last_value: String(row.last_value),
    is_called: Boolean(row.is_called),
  }
}

async function captureAllMigrationSerials(
  pool: ReturnType<typeof createTestPool>,
): Promise<Record<(typeof MIGRATION_SERIALS)[number], SerialState>> {
  const out = {} as Record<(typeof MIGRATION_SERIALS)[number], SerialState>
  for (const seq of MIGRATION_SERIALS) {
    out[seq] = await readSerialState(pool, seq)
  }
  return out
}

function expectedNextSerialValue(state: SerialState): number {
  const lastValue = Number(state.last_value)
  return state.is_called ? lastValue + 1 : lastValue
}

async function peekNextSerial(
  pool: ReturnType<typeof createTestPool>,
  table: string,
  column: string,
): Promise<number> {
  const row = await pool.query(
    `SELECT nextval(pg_get_serial_sequence($1,$2)) AS n`,
    [table, column],
  )
  return Number(row.rows[0]!.n)
}

const sharedPool = createTestPool()

afterAll(async () => {
  await sharedPool.end()
})

describe('迁移序列状态 RED', () => {
  const pool = sharedPool

  beforeEach(async () => {
    clearMigrationEnv()
    await resetTestDatabase()
    await resetTestSandboxes()
  })

  it('inquiry_email_outbox 无行且序列尚未调用时，迁移后 last_value/is_called 与迁移前一致', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await pool.query(`DELETE FROM inquiry_email_outbox`)
    await pool.query(`SELECT setval('inquiry_email_outbox_outbox_id_seq', 1, false)`)
    await seedUsers(pool)
    setLegacyMigrationEnv()

    const before = await captureAllMigrationSerials(pool)
    expect(before.inquiry_email_outbox_outbox_id_seq.is_called).toBe(false)

    await migrateToCollaborationModel(pool)

    const after = await captureAllMigrationSerials(pool)
    expect(after.inquiry_email_outbox_outbox_id_seq).toEqual(before.inquiry_email_outbox_outbox_id_seq)

    const nextOutboxId = await peekNextSerial(pool, 'inquiry_email_outbox', 'outbox_id')
    expect(nextOutboxId).toBe(expectedNextSerialValue(before.inquiry_email_outbox_outbox_id_seq))
  })

  it('inquiry_email_outbox 无行但序列 last_value 高于 MAX(outbox_id) 时，迁移后仍保留原序列状态', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await pool.query(`DELETE FROM inquiry_email_outbox`)
    await pool.query(`SELECT setval('inquiry_email_outbox_outbox_id_seq', 12, true)`)
    await seedUsers(pool)
    setLegacyMigrationEnv()

    const maxOut = await pool.query(`SELECT COALESCE(MAX(outbox_id),0)::bigint AS m FROM inquiry_email_outbox`)
    expect(Number(maxOut.rows[0]!.m)).toBe(0)

    const before = await readSerialState(pool, 'inquiry_email_outbox_outbox_id_seq')
    expect(Number(before.last_value)).toBe(12)
    expect(before.is_called).toBe(true)

    await migrateToCollaborationModel(pool)

    const after = await readSerialState(pool, 'inquiry_email_outbox_outbox_id_seq')
    expect(after).toEqual(before)

    const nextOutboxId = await peekNextSerial(pool, 'inquiry_email_outbox', 'outbox_id')
    expect(nextOutboxId).toBe(13)
  })

  it('三条迁移相关序列的 last_value/is_called 在完整 legacy 数据迁移后全部与迁移前一致', async () => {
    requireRemoteServiceConfig()
    await createFullLegacyTenantSchema(pool)
    await seedUsers(pool)
    setLegacyMigrationEnv()

    const before = await captureAllMigrationSerials(pool)
    await migrateToCollaborationModel(pool)
    const after = await captureAllMigrationSerials(pool)

    for (const seq of MIGRATION_SERIALS) {
      expect(after[seq], seq).toEqual(before[seq])
    }

    const draftId = stableDraftIdForLegacySite(LEGACY_SITE)
    expect(draftId.length).toBeGreaterThan(0)

    const nextInq = await peekNextSerial(pool, 'inquiries', 'inquiry_id')
    const nextOut = await peekNextSerial(pool, 'inquiry_email_outbox', 'outbox_id')
    const nextEv = await peekNextSerial(pool, 'analytics_events', 'event_id')
    expect(nextInq).toBe(expectedNextSerialValue(before.inquiries_inquiry_id_seq))
    expect(nextOut).toBe(expectedNextSerialValue(before.inquiry_email_outbox_outbox_id_seq))
    expect(nextEv).toBe(expectedNextSerialValue(before.analytics_events_event_id_seq))
  })
})

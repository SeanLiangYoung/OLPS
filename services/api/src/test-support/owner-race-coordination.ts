import pg from 'pg'
import { getTestDatabaseUrl } from './reset-test-db.js'

let lockPollPool: pg.Pool | null = null

function getLockPollPool(): pg.Pool {
  if (!lockPollPool) {
    lockPollPool = new pg.Pool({ connectionString: getTestDatabaseUrl(), max: 2 })
  }
  return lockPollPool
}

async function applyClientSearchPath(client: pg.PoolClient): Promise<void> {
  const schema = process.env.PG_TEST_SCHEMA
  if (!schema) {
    throw new Error('测试缺少 PG_TEST_SCHEMA')
  }
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error(`非法 schema 名称: ${schema}`)
  }
  await client.query(`SET search_path TO "${schema}"`)
}

function requireTestSchema(): string {
  const schema = process.env.PG_TEST_SCHEMA
  if (!schema) {
    throw new Error('测试缺少 PG_TEST_SCHEMA')
  }
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error(`非法 schema 名称: ${schema}`)
  }
  return schema
}

export async function queryDraftOwnerUserIds(pool: pg.Pool, draftId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT user_id FROM draft_owners WHERE draft_id=$1 ORDER BY created_at, user_id`,
    [draftId],
  )
  return result.rows.map((row) => String(row.user_id))
}

export async function querySiteOwnerUserIds(pool: pg.Pool, siteId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT user_id FROM site_owners WHERE site_id=$1 ORDER BY created_at, user_id`,
    [siteId],
  )
  return result.rows.map((row) => String(row.user_id))
}

export async function queryDraftOwnerAccounts(pool: pg.Pool, draftId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT u.account FROM draft_owners o
     INNER JOIN users u ON u.user_id=o.user_id
     WHERE o.draft_id=$1 ORDER BY o.created_at, u.account`,
    [draftId],
  )
  return result.rows.map((row) => String(row.account))
}

export async function querySiteOwnerAccounts(pool: pg.Pool, siteId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT u.account FROM site_owners o
     INNER JOIN users u ON u.user_id=o.user_id
     WHERE o.site_id=$1 ORDER BY o.created_at, u.account`,
    [siteId],
  )
  return result.rows.map((row) => String(row.account))
}

async function waitForOwnerMutationBlocked(
  waitPool: pg.Pool,
  tableName: string,
  holdingPid: number,
  timeoutMs: number,
): Promise<void> {
  const schema = requireTestSchema()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const waiting = await waitPool.query(
      `SELECT 1
       FROM pg_stat_activity blocked
       INNER JOIN pg_locks granted ON granted.pid = $1 AND granted.granted
       INNER JOIN pg_class c ON c.oid = granted.relation
       INNER JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE blocked.pid <> $1
         AND $1 = ANY(pg_blocking_pids(blocked.pid))
         AND blocked.wait_event_type = 'Lock'
         AND n.nspname = $2
         AND c.relname = $3
       LIMIT 1`,
      [holdingPid, schema, tableName],
    )
    if ((waiting.rowCount ?? 0) > 0) {
      return
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 15)
    })
  }
  throw new Error(`等待 ${schema}.${tableName} 行锁阻塞超时`)
}

async function runWhileBlockingOwnerRemoval<T>(
  pool: pg.Pool,
  tableName: 'draft_owners' | 'site_owners',
  lockSql: string,
  lockValue: string,
  revokeSql: string,
  revokeParams: [string, string],
  httpCall: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  let httpPromise: Promise<T> | undefined
  try {
    await applyClientSearchPath(client)
    const holdingPid = (await client.query(`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid as number
    await client.query('BEGIN')
    await client.query(lockSql, [lockValue])
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        httpPromise = httpCall()
        resolve()
      })
    })
    await waitForOwnerMutationBlocked(getLockPollPool(), tableName, holdingPid, 15_000)
    await client.query(revokeSql, revokeParams)
    await client.query('COMMIT')
    return await httpPromise!
  } catch (error) {
    await client.query('ROLLBACK')
    if (httpPromise) {
      await httpPromise.catch(() => undefined)
    }
    throw error
  } finally {
    client.release()
  }
}

export async function runWhileBlockingDraftOwnerRemoval<T>(
  pool: pg.Pool,
  draftId: string,
  revokeActorUserId: string,
  httpCall: () => Promise<T>,
): Promise<T> {
  return runWhileBlockingOwnerRemoval(
    pool,
    'draft_owners',
    `SELECT user_id FROM draft_owners WHERE draft_id=$1 FOR UPDATE`,
    draftId,
    `DELETE FROM draft_owners WHERE draft_id=$1 AND user_id=$2`,
    [draftId, revokeActorUserId],
    httpCall,
  )
}

export async function runWhileBlockingSiteOwnerRemoval<T>(
  pool: pg.Pool,
  siteId: string,
  revokeActorUserId: string,
  httpCall: () => Promise<T>,
): Promise<T> {
  return runWhileBlockingOwnerRemoval(
    pool,
    'site_owners',
    `SELECT user_id FROM site_owners WHERE site_id=$1 FOR UPDATE`,
    siteId,
    `DELETE FROM site_owners WHERE site_id=$1 AND user_id=$2`,
    [siteId, revokeActorUserId],
    httpCall,
  )
}

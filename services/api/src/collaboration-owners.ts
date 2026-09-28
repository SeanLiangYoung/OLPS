import type { UserRecord } from '@olps/domain'
import { pool } from './db.js'
import { isDraftOwner, isSiteOwner } from './permissions.js'
import { findUserByAccountOnly } from './users.js'

async function mapUsers(rows: Array<Record<string, unknown>>): Promise<UserRecord[]> {
  return rows.map((row) => ({
    userId: String(row.user_id),
    account: String(row.account),
    name: String(row.name),
  }))
}

export async function listDraftOwners(userId: string, draftId: string): Promise<UserRecord[]> {
  if (!(await isDraftOwner(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const result = await pool.query(
    `SELECT u.user_id, u.account, u.name FROM draft_owners o
     INNER JOIN users u ON u.user_id=o.user_id
     WHERE o.draft_id=$1 ORDER BY o.created_at`,
    [draftId],
  )
  return mapUsers(result.rows)
}

export async function addDraftOwner(
  actorUserId: string,
  draftId: string,
  account: string,
): Promise<void> {
  if (!(await isDraftOwner(actorUserId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const user = await findUserByAccountOnly(account)
  if (!user) {
    throw new Error(`用户不存在: ${account}`)
  }
  const now = new Date().toISOString()
  await pool.query(
    `INSERT INTO draft_owners(draft_id, user_id, created_at) VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING`,
    [draftId, user.userId, now],
  )
}

export async function removeDraftOwner(
  actorUserId: string,
  draftId: string,
  targetUserId: string,
): Promise<void> {
  if (!(await isDraftOwner(actorUserId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT user_id FROM draft_owners WHERE draft_id=$1 FOR UPDATE`,
      [draftId],
    )
    if (locked.rowCount <= 1) {
      throw new Error('LAST_DRAFT_OWNER')
    }
    await client.query(`DELETE FROM draft_owners WHERE draft_id=$1 AND user_id=$2`, [
      draftId,
      targetUserId,
    ])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listSiteOwners(userId: string, siteId: string): Promise<UserRecord[]> {
  if (!(await isSiteOwner(userId, siteId))) {
    throw new Error('FORBIDDEN')
  }
  const result = await pool.query(
    `SELECT u.user_id, u.account, u.name FROM site_owners o
     INNER JOIN users u ON u.user_id=o.user_id
     WHERE o.site_id=$1 ORDER BY o.created_at`,
    [siteId],
  )
  return mapUsers(result.rows)
}

export async function addSiteOwner(
  actorUserId: string,
  siteId: string,
  account: string,
): Promise<void> {
  if (!(await isSiteOwner(actorUserId, siteId))) {
    throw new Error('FORBIDDEN')
  }
  const user = await findUserByAccountOnly(account)
  if (!user) {
    throw new Error(`用户不存在: ${account}`)
  }
  const now = new Date().toISOString()
  await pool.query(
    `INSERT INTO site_owners(site_id, user_id, created_at) VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING`,
    [siteId, user.userId, now],
  )
}

export async function removeSiteOwner(
  actorUserId: string,
  siteId: string,
  targetUserId: string,
): Promise<void> {
  if (!(await isSiteOwner(actorUserId, siteId))) {
    throw new Error('FORBIDDEN')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT user_id FROM site_owners WHERE site_id=$1 FOR UPDATE`,
      [siteId],
    )
    if (locked.rowCount <= 1) {
      throw new Error('LAST_SITE_OWNER')
    }
    await client.query(`DELETE FROM site_owners WHERE site_id=$1 AND user_id=$2`, [
      siteId,
      targetUserId,
    ])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

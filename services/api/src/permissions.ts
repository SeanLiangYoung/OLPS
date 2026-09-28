import { pool } from './db.js'

export async function isDraftOwner(userId: string, draftId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM draft_owners WHERE draft_id=$1 AND user_id=$2`,
    [draftId, userId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function isSiteOwner(userId: string, siteId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM site_owners WHERE site_id=$1 AND user_id=$2`,
    [siteId, userId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function countDraftOwners(draftId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS c FROM draft_owners WHERE draft_id=$1`,
    [draftId],
  )
  return Number(result.rows[0]!.c)
}

export async function countSiteOwners(siteId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS c FROM site_owners WHERE site_id=$1`,
    [siteId],
  )
  return Number(result.rows[0]!.c)
}

export async function canSyncDraft(userId: string, draftId: string): Promise<boolean> {
  if (!(await isDraftOwner(userId, draftId))) {
    return false
  }
  const draft = await pool.query(`SELECT site_id FROM site_drafts WHERE draft_id=$1`, [draftId])
  if (!draft.rowCount) {
    return false
  }
  const siteId = draft.rows[0]!.site_id as string | null
  if (!siteId) {
    return true
  }
  return isSiteOwner(userId, siteId)
}

export async function canPublishDraft(userId: string, draftId: string): Promise<boolean> {
  if (!(await isDraftOwner(userId, draftId))) {
    return false
  }
  const draft = await pool.query(`SELECT site_id FROM site_drafts WHERE draft_id=$1`, [draftId])
  if (!draft.rowCount) {
    return false
  }
  const siteId = draft.rows[0]!.site_id as string | null
  if (!siteId) {
    return true
  }
  return isSiteOwner(userId, siteId)
}

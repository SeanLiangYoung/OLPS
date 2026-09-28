import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { pool } from './db.js'
import { appConfig } from './config.js'
import { isDraftOwner } from './permissions.js'

function hashPreviewToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createPreviewToken(): string {
  return randomBytes(32).toString('base64url')
}

export type PreviewCapabilityRecord = {
  capabilityId: string
  sessionId: string
  userId: string
  draftId: string
  pageId: string
  pageSlug: string
  entryRoute: string
  expiresAt: Date
}

export async function insertPreviewCapability(input: {
  sessionId: string
  userId: string
  draftId: string
  pageId: string
  pageSlug: string
  entryRoute: string
  rawToken: string
}): Promise<{ capabilityId: string; expiresAt: Date }> {
  const capabilityId = randomUUID()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + appConfig.previewCredentialTtlSeconds * 1000)
  await pool.query(
    `INSERT INTO draft_preview_capabilities(
      capability_id, token_hash, session_id, user_id, draft_id, page_id, page_slug, entry_route, expires_at, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      capabilityId,
      hashPreviewToken(input.rawToken),
      input.sessionId,
      input.userId,
      input.draftId,
      input.pageId,
      input.pageSlug,
      input.entryRoute,
      expiresAt.toISOString(),
      now.toISOString(),
    ],
  )
  return { capabilityId, expiresAt }
}

export async function resolvePreviewCapability(
  rawToken: string,
): Promise<PreviewCapabilityRecord | null> {
  const result = await pool.query(
    `SELECT c.capability_id, c.session_id, c.user_id, c.draft_id, c.page_id, c.page_slug, c.entry_route, c.expires_at
     FROM draft_preview_capabilities c
     INNER JOIN sessions s ON s.session_id = c.session_id
     WHERE c.token_hash=$1`,
    [hashPreviewToken(rawToken)],
  )
  if (!result.rowCount) {
    return null
  }
  const row = result.rows[0]!
  const expiresAt = new Date(String(row.expires_at))
  if (expiresAt.getTime() <= Date.now()) {
    await pool.query(`DELETE FROM draft_preview_capabilities WHERE capability_id=$1`, [
      String(row.capability_id),
    ])
    return null
  }
  if (!(await isDraftOwner(String(row.user_id), String(row.draft_id)))) {
    return null
  }
  return {
    capabilityId: String(row.capability_id),
    sessionId: String(row.session_id),
    userId: String(row.user_id),
    draftId: String(row.draft_id),
    pageId: String(row.page_id),
    pageSlug: String(row.page_slug),
    entryRoute: String(row.entry_route ?? ''),
    expiresAt,
  }
}

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { UserRecord } from '@olps/domain'
import { appConfig } from './config.js'
import { pool } from './db.js'
import { findUserById } from './users.js'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createAccessToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function createSession(userId: string, rawToken: string): Promise<void> {
  const now = new Date()
  const expires = new Date(now.getTime() + appConfig.sessionTtlHours * 60 * 60 * 1000)
  await pool.query(
    `INSERT INTO sessions(session_id, user_id, token_hash, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), userId, hashToken(rawToken), expires.toISOString(), now.toISOString()],
  )
}

export async function deleteSessionByToken(rawToken: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE token_hash=$1`, [hashToken(rawToken)])
}

export async function resolveUserFromToken(rawToken: string): Promise<UserRecord | null> {
  const result = await pool.query(
    `SELECT user_id, expires_at FROM sessions WHERE token_hash=$1`,
    [hashToken(rawToken)],
  )
  if (!result.rowCount) {
    return null
  }
  const row = result.rows[0]!
  const expiresAt = new Date(String(row.expires_at))
  if (expiresAt.getTime() <= Date.now()) {
    await pool.query(`DELETE FROM sessions WHERE token_hash=$1`, [hashToken(rawToken)])
    return null
  }
  return findUserById(String(row.user_id))
}

import { randomUUID } from 'node:crypto'
import type { UserRecord } from '@olps/domain'
import { pool } from './db.js'
import { hashPassword } from './password.js'

function mapUser(row: Record<string, unknown>): UserRecord {
  return {
    userId: String(row.user_id),
    account: String(row.account),
    name: String(row.name),
  }
}

export async function createUser(input: {
  account: string
  password: string
  name?: string
}): Promise<UserRecord> {
  const displayName = input.name?.trim() || input.account
  const now = new Date().toISOString()
  const userId = randomUUID()
  const passwordHash = hashPassword(input.password)
  await pool.query(
    `INSERT INTO users(user_id, account, password_hash, name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, input.account, passwordHash, displayName, now, now],
  )
  return { userId, account: input.account, name: displayName }
}

export async function findUserByAccount(account: string): Promise<
  (UserRecord & { passwordHash: string }) | null
> {
  const result = await pool.query(`SELECT * FROM users WHERE account=$1`, [account])
  if (!result.rowCount) {
    return null
  }
  const row = result.rows[0]!
  return {
    ...mapUser(row),
    passwordHash: String(row.password_hash),
  }
}

export async function findUserById(userId: string): Promise<UserRecord | null> {
  const result = await pool.query(`SELECT * FROM users WHERE user_id=$1`, [userId])
  if (!result.rowCount) {
    return null
  }
  return mapUser(result.rows[0]!)
}

export async function findUserByAccountOnly(account: string): Promise<UserRecord | null> {
  const result = await pool.query(`SELECT * FROM users WHERE account=$1`, [account])
  if (!result.rowCount) {
    return null
  }
  return mapUser(result.rows[0]!)
}

import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type pg from 'pg'
import { pool } from './db.js'
import { hashPassword } from './password.js'
import { findUserByAccount } from './users.js'

type BootstrapUserSpec = {
  account: string
  name?: string
}

function parseBootstrapUsersEnv(): BootstrapUserSpec[] {
  const raw = process.env.MIGRATION_BOOTSTRAP_USERS?.trim()
  if (!raw) {
    throw new Error('缺少环境变量 MIGRATION_BOOTSTRAP_USERS')
  }
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('MIGRATION_BOOTSTRAP_USERS 必须是非空 JSON 数组')
  }
  const out: BootstrapUserSpec[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('MIGRATION_BOOTSTRAP_USERS 每一项必须是对象')
    }
    const account = String((entry as { account?: unknown }).account ?? '').trim()
    if (!account) {
      throw new Error('MIGRATION_BOOTSTRAP_USERS 每一项必须包含 account')
    }
    const nameRaw = (entry as { name?: unknown }).name
    const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : undefined
    out.push({ account, name })
  }
  return out
}

function resolveCredentialsPath(): string {
  const raw = process.env.MIGRATION_BOOTSTRAP_CREDENTIALS_PATH?.trim()
  if (!raw) {
    throw new Error('缺少环境变量 MIGRATION_BOOTSTRAP_CREDENTIALS_PATH')
  }
  return path.resolve(raw)
}

function generateRandomPassword(): string {
  return randomBytes(32).toString('base64url')
}

async function ensureUsersTable(): Promise<void> {
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
}

async function insertBootstrapUser(
  client: pg.PoolClient,
  spec: BootstrapUserSpec,
  password: string,
): Promise<void> {
  const now = new Date().toISOString()
  const userId = randomUUID()
  const displayName = spec.name ?? spec.account
  const passwordHash = hashPassword(password)
  await client.query(
    `INSERT INTO users(user_id, account, password_hash, name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, spec.account, passwordHash, displayName, now, now],
  )
}

function writeCredentialsFileExclusive(
  credentialsPath: string,
  credentials: Record<string, { password: string; name: string }>,
): void {
  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true })
  const fd = fs.openSync(credentialsPath, 'wx', 0o600)
  try {
    fs.writeFileSync(
      fd,
      `${JSON.stringify(credentials, null, 2)}\n`,
      { encoding: 'utf8' },
    )
  } finally {
    fs.closeSync(fd)
  }
}

async function main(): Promise<void> {
  const specs = parseBootstrapUsersEnv()
  const credentialsPath = resolveCredentialsPath()

  if (fs.existsSync(credentialsPath)) {
    throw new Error(`凭据文件已存在，拒绝覆盖: ${credentialsPath}`)
  }

  await ensureUsersTable()

  const credentials: Record<string, { password: string; name: string }> = {}
  const toCreate: Array<{ spec: BootstrapUserSpec; password: string }> = []

  for (const spec of specs) {
    const existing = await findUserByAccount(spec.account)
    if (existing) {
      continue
    }
    const password = generateRandomPassword()
    toCreate.push({ spec, password })
    credentials[spec.account] = {
      password,
      name: spec.name ?? spec.account,
    }
  }

  if (!toCreate.length) {
    console.log(`migration-bootstrap-users: 全部账号已存在，未写入新凭据`)
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const entry of toCreate) {
      await insertBootstrapUser(client, entry.spec, entry.password)
    }
    writeCredentialsFileExclusive(credentialsPath, credentials)
    await client.query('COMMIT')
  } catch (error: unknown) {
    await client.query('ROLLBACK')
    if (fs.existsSync(credentialsPath)) {
      fs.unlinkSync(credentialsPath)
    }
    throw error
  } finally {
    client.release()
  }

  console.log(`migration-bootstrap-users: 已创建 ${toCreate.length} 个账号，凭据已写入文件`)
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`migration-bootstrap-users 失败: ${message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })

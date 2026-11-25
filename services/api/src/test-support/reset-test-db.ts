import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const worktreeRoot = path.resolve(apiRoot, '../..')
const knowledgePgSchemaFile = path.join(worktreeRoot, '.intermediate', 'knowledge-projection-pg-schema')

export function getTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL
  if (!url?.trim()) {
    throw new Error('测试缺少 DATABASE_URL 或 TEST_DATABASE_URL')
  }
  return url.trim()
}

export function assertTestDatabaseName(url: string): void {
  let databaseName = ''
  try {
    const parsed = new URL(url.replace(/^postgres:/, 'http:'))
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  } catch {
    throw new Error(`无法解析测试数据库连接串: ${url}`)
  }
  if (!databaseName.includes('_test_')) {
    throw new Error(`拒绝清理非测试库（库名须包含 _test_）: ${databaseName}`)
  }
}

function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`非法 schema 名称: ${name}`)
  }
  return `"${name}"`
}

let testPoolInstance: pg.Pool | null = null

function buildTestPool(): pg.Pool {
  const url = getTestDatabaseUrl()
  assertTestDatabaseName(url)
  const schema = process.env.PG_TEST_SCHEMA
  if (!schema) throw new Error('测试缺少 PG_TEST_SCHEMA')
  return new pg.Pool({ connectionString: url, options: `-c search_path=${quoteIdent(schema)}` })
}

async function endTestPoolInstance(): Promise<void> {
  if (!testPoolInstance) {
    return
  }
  const closing = testPoolInstance
  testPoolInstance = null
  await closing.end()
}

export async function recreateTestPool(): Promise<void> {
  await endTestPoolInstance()
  testPoolInstance = buildTestPool()
}

export function createTestPool(): pg.Pool {
  return testPoolProxy
}

const testPoolProxy = new Proxy({} as pg.Pool, {
  get(_target, prop, receiver) {
    if (!testPoolInstance) {
      testPoolInstance = buildTestPool()
    }
    const value = Reflect.get(testPoolInstance, prop, testPoolInstance)
    return typeof value === 'function' ? value.bind(testPoolInstance) : value
  },
})

export async function syncSearchPath(pool: pg.Pool): Promise<void> {
  const schema = process.env.PG_TEST_SCHEMA
  if (!schema) {
    throw new Error('测试缺少 PG_TEST_SCHEMA')
  }
  await pool.query(`SET search_path TO ${quoteIdent(schema)}`)
}

let appPoolClosed = false

export async function resetTestDatabase(): Promise<void> {
  const url = getTestDatabaseUrl()
  assertTestDatabaseName(url)

  const previousSchema = process.env.PG_TEST_SCHEMA
  const schema = `test_api_${randomBytes(8).toString('hex')}`
  process.env.PG_TEST_SCHEMA = schema
  await fs.mkdir(path.dirname(knowledgePgSchemaFile), { recursive: true })
  await fs.writeFile(knowledgePgSchemaFile, schema, 'utf8')

  if (!appPoolClosed) {
    const db = await import('../db.js')
    await db.pool.end()
    appPoolClosed = true
  }

  await endTestPoolInstance()

  const admin = new pg.Pool({ connectionString: url })
  try {
    if (previousSchema && previousSchema !== schema) {
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(previousSchema)} CASCADE`)
    }
    await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`)
  } finally {
    await admin.end()
  }

  const { recreatePool, pool: applicationPool } = await import('../db.js')
  const { migrate } = await import('../db-schema.js')
  recreatePool()
  appPoolClosed = false
  await migrate()
  const { migrateCmsRuntime } = await import('../cms-runtime-schema.js')
  await migrateCmsRuntime(applicationPool)
  await recreateTestPool()
}

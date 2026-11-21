import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { inject } from 'vitest'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const worktreeRoot = path.resolve(apiRoot, '../..')
const intermediateRoot = path.join(worktreeRoot, '.intermediate')

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://olps:olps@127.0.0.1:5434/olps_test_api'

if (!testDatabaseUrl.includes('_test_')) {
  throw new Error(`Vitest 只允许连接名称包含 _test_ 的数据库: ${testDatabaseUrl}`)
}

process.env.DATABASE_URL = testDatabaseUrl
process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
process.env.TEST_DATABASE_URL = testDatabaseUrl

if (!process.env.PG_TEST_SCHEMA) {
  process.env.PG_TEST_SCHEMA = ''
}
process.env.SANDBOX_ROOT = path.join(intermediateRoot, 'sandboxes-test')
process.env.PREVIEW_ROOT = path.join(intermediateRoot, 'preview-test')
process.env.PUBLISH_ROOT = path.join(intermediateRoot, 'publish-test')

const remoteServiceUrl = inject('remoteServiceUrl')
const remoteServiceToken = inject('remoteServiceToken')
const remoteDataRoot = inject('remoteDataRoot')
if (!remoteServiceUrl?.trim() || !remoteServiceToken?.trim() || !remoteDataRoot?.trim()) {
  throw new Error(
    'Vitest globalSetup 未通过 provide 注入 remoteServiceUrl / remoteServiceToken / remoteDataRoot',
  )
}
process.env.REMOTE_SERVICE_URL = remoteServiceUrl.trim()
process.env.REMOTE_SERVICE_TOKEN = remoteServiceToken.trim()
process.env.REMOTE_DATA_ROOT = remoteDataRoot.trim()

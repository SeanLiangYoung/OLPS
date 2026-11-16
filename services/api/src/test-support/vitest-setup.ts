import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inject } from 'vitest'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const worktreeRoot = path.resolve(apiRoot, '../..')
const intermediateRoot = path.join(worktreeRoot, '.intermediate')
const testRunRoot = path.join(intermediateRoot, 'api-test-runs', String(process.pid))

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://olps:olps@127.0.0.1:5434/olps_test_api'

if (!testDatabaseUrl.includes('_test_')) {
  throw new Error(`Vitest 只允许连接名称包含 _test_ 的数据库: ${testDatabaseUrl}`)
}

process.env.DATABASE_URL = testDatabaseUrl
process.env.TEST_DATABASE_URL = testDatabaseUrl

if (!process.env.PG_TEST_SCHEMA) {
  process.env.PG_TEST_SCHEMA = ''
}
process.env.SANDBOX_ROOT = path.join(testRunRoot, 'sandboxes-test')
process.env.PREVIEW_ROOT = path.join(testRunRoot, 'preview-test')
process.env.PUBLISH_ROOT = path.join(testRunRoot, 'publish-test')

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

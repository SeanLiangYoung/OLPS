import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startRemoteServer } from '../../../services/remote/src/test-harness.js'

const dataRoot = process.env.E2E_REMOTE_DATA_ROOT
const portRaw = process.env.E2E_REMOTE_PORT
if (!dataRoot?.trim()) {
  throw new Error('E2E_REMOTE_DATA_ROOT 未设置')
}
if (!portRaw?.trim()) {
  throw new Error('E2E_REMOTE_PORT 未设置')
}
const port = Number(portRaw)
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`E2E_REMOTE_PORT 非法: ${portRaw}`)
}
const token = process.env.REMOTE_SERVICE_TOKEN?.trim() || 'olps-e2e-remote-token'

const { baseUrl, close } = await startRemoteServer({
  dataRoot: path.resolve(dataRoot),
  serviceToken: token,
  publicBaseUrl: `http://127.0.0.1:${port}`,
  listenPort: port,
})

process.stdout.write(`${JSON.stringify({ baseUrl })}\n`)

process.on('SIGTERM', () => {
  close()
  process.exit(0)
})

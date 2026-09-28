import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const remoteRoot =
  process.env.REMOTE_WORKTREE_ROOT ?? path.resolve(apiRoot, '../../../remote/services/remote')

const harnessPath = path.join(remoteRoot, 'src', 'test-harness.ts')
if (!fs.existsSync(harnessPath)) {
  process.stderr.write(`远端 test-harness 不存在: ${harnessPath}\n`)
  process.exit(2)
}

const token = process.env.REMOTE_SERVICE_TOKEN ?? 'olps-remote-integration-token'

const harness = (await import(pathToFileURL(harnessPath).href)) as {
  makeIsolatedDataRoot: (label: string) => Promise<string>
  startRemoteServer: (config: {
    dataRoot: string
    serviceToken: string
    publicBaseUrl: string
    listenPort?: number
  }) => Promise<{ baseUrl: string; close: () => void }>
}

const dataRoot = await harness.makeIsolatedDataRoot('api-integration-child')
const server = await harness.startRemoteServer({
  dataRoot,
  serviceToken: token,
  publicBaseUrl: 'http://127.0.0.1:0',
})

process.stdout.write(JSON.stringify({ baseUrl: server.baseUrl, dataRoot }))

const keepAlive = setInterval(() => {}, 60_000)
process.on('SIGTERM', () => {
  clearInterval(keepAlive)
  server.close()
  process.exit(0)
})

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const remoteRoot =
  process.env.REMOTE_WORKTREE_ROOT ?? path.resolve(apiRoot, '../../../remote/services/remote')

async function main(): Promise<void> {
  const harnessPath = path.join(remoteRoot, 'src', 'test-harness.ts')
  if (!fs.existsSync(harnessPath)) {
    throw new Error(`远端 test-harness 不存在: ${harnessPath}`)
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

  process.stdout.write(`${JSON.stringify({ baseUrl: server.baseUrl, dataRoot })}\n`)

  await new Promise<void>((resolve) => {
    process.once('SIGTERM', () => {
      server.close()
      resolve()
    })
  })
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})

import { serve } from '@hono/node-server'
import { createRemoteApp } from './app.js'
import { readRemoteListenPort } from './env-config.js'
import type { RemoteServiceConfig } from './types.js'

const dataRoot = process.env.REMOTE_DATA_ROOT ?? '.intermediate/remote-data'
const serviceToken = process.env.REMOTE_SERVICE_TOKEN?.trim() ?? ''
if (!serviceToken) {
  console.error('必须设置非空环境变量 REMOTE_SERVICE_TOKEN')
  process.exit(1)
}
const host = process.env.REMOTE_HOST ?? '127.0.0.1'
const port = readRemoteListenPort(process.env)
const publicBaseUrl = process.env.REMOTE_PUBLIC_BASE_URL?.trim()
if (!publicBaseUrl) {
  console.error('必须设置完整环境变量 REMOTE_PUBLIC_BASE_URL')
  process.exit(1)
}

const config: RemoteServiceConfig = {
  dataRoot,
  serviceToken,
  publicBaseUrl,
  listenPort: port,
}

const app = createRemoteApp(config)
serve({ fetch: app.fetch, port, hostname: host })
console.log(`remote service listening on http://${host}:${port}`)

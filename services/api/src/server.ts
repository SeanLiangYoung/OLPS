import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { appConfig } from './config.js'
import { migrate, pool } from './db.js'
import { legacySitesHaveTenantId, migrateToCollaborationModel } from './migrate.js'
import { app } from './app.js'
import { startMailWorker } from './mail-worker.js'
import { startPageJobWorker } from './page-job-worker.js'

async function main(): Promise<void> {
  fs.mkdirSync(appConfig.publishRoot, { recursive: true })
  fs.mkdirSync(appConfig.previewRoot, { recursive: true })
  fs.mkdirSync(appConfig.sandboxRoot, { recursive: true })
  if (await legacySitesHaveTenantId(pool)) {
    await migrateToCollaborationModel(pool)
  } else {
    await migrate()
  }
  const server = serve({ fetch: app.fetch, port: appConfig.port, hostname: appConfig.host }, (info) => {
    console.log(`OLPS API listening on http://${appConfig.host}:${info.port}`)
  })
  const mailWorker = startMailWorker()
  const stopPageWorker = startPageJobWorker()
  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    server.close()
    await stopPageWorker()
    await mailWorker.stop()
    await pool.end()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

main().catch(async (error) => {
  console.error(error)
  await pool.end()
  process.exit(1)
})

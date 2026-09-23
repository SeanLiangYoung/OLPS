import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { appConfig } from './config.js'
import { migrate, pool } from './db.js'
import { app } from './app.js'

async function main(): Promise<void> {
  fs.mkdirSync(appConfig.publishRoot, { recursive: true })
  fs.mkdirSync(appConfig.previewRoot, { recursive: true })
  await migrate()
  serve({ fetch: app.fetch, port: appConfig.port, hostname: '127.0.0.1' }, (info) => {
    console.log(`OLPS API listening on http://127.0.0.1:${info.port}`)
  })
}

main().catch(async (error) => {
  console.error(error)
  await pool.end()
  process.exit(1)
})

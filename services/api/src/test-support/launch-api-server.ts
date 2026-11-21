import fs from 'node:fs'
import type pg from 'pg'
import { serve } from '@hono/node-server'

let poolRef: pg.Pool | null = null

async function shutdown(pool: pg.Pool): Promise<void> {
  await pool.end()
  process.exit(0)
}

async function main(): Promise<void> {
  if (!process.env.PG_TEST_SCHEMA?.trim()) {
    throw new Error('API 子进程缺少 PG_TEST_SCHEMA')
  }
  process.env.PORT = process.env.API_TEST_LISTEN_PORT ?? '0'
  const { appConfig } = await import('../config.js')
  const { pool } = await import('../db.js')
  const { migrate } = await import('../db-schema.js')
  poolRef = pool
  const { legacySitesHaveTenantId, migrateToCollaborationModel } = await import('../migrate.js')
  const { app } = await import('../app.js')
  const { migrateCmsRuntime } = await import('../cms-runtime-schema.js')

  fs.mkdirSync(appConfig.publishRoot, { recursive: true })
  fs.mkdirSync(appConfig.previewRoot, { recursive: true })
  fs.mkdirSync(appConfig.sandboxRoot, { recursive: true })
  if (await legacySitesHaveTenantId(pool)) {
    await migrateToCollaborationModel(pool)
  } else {
    await migrate()
  }
  await migrateCmsRuntime(pool)

  process.once('SIGTERM', () => {
    void shutdown(pool)
  })

  serve({ fetch: app.fetch, port: appConfig.port, hostname: '127.0.0.1' }, (info) => {
    process.stdout.write(`${JSON.stringify({ baseUrl: `http://127.0.0.1:${info.port}` })}\n`)
  })
}

main().catch(async (error) => {
  console.error(error)
  if (poolRef) {
    await poolRef.end()
  }
  process.exit(1)
})

import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { appConfig } from './config.js'
import { migrate, pool } from './db.js'
import { legacySitesHaveTenantId, migrateToCollaborationModel } from './migrate.js'
import { cmsApp as app } from './cms-app.js'
import { migrateCmsRuntime } from './cms-runtime-schema.js'
import { assertCredentialsKey } from './credentials.js'
import { resumeCmsInitializations } from './cms-initialization.js'
import { startDailyMarketingSync } from './marketing-scheduler.js'
import { startInquiryDeliveries } from './inquiry-delivery.js'

async function main(): Promise<void> {
  assertCredentialsKey()
  fs.mkdirSync(appConfig.publishRoot, { recursive: true })
  fs.mkdirSync(appConfig.previewRoot, { recursive: true })
  fs.mkdirSync(appConfig.sandboxRoot, { recursive: true })
  if (await legacySitesHaveTenantId(pool)) {
    await migrateToCollaborationModel(pool)
  } else {
    await migrate()
  }
  await migrateCmsRuntime(pool)
  void resumeCmsInitializations()
  startDailyMarketingSync()
  startInquiryDeliveries()
  serve({ fetch: app.fetch, port: appConfig.port, hostname: '127.0.0.1' }, (info) => {
    console.log(`OLPS API listening on http://127.0.0.1:${info.port}`)
  })
}

main().catch(async (error) => {
  console.error(error)
  await pool.end()
  process.exit(1)
})

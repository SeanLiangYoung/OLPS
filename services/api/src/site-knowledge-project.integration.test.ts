import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { expect, it } from 'vitest'
import { inject } from 'vitest'
import { migrateWithClient } from './db-schema.js'
import { migrateCmsSchema } from './cms-schema.js'
import { createUnpublishedSite } from './site-lifecycle.js'
import { KnowledgeProjectBootstrapError } from './knowledge-service-client.js'

async function createIsolatedSchema(databaseUrl: string): Promise<{ schema: string; pool: pg.Pool; admin: pg.Client }> {
  if (!new URL(databaseUrl).pathname.includes('_test_')) {
    throw new Error('只允许专用测试数据库')
  }
  const schema = `ks_site_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: databaseUrl })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  const client = await pool.connect()
  try {
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    await migrateCmsSchema(client)
  } finally {
    client.release()
  }
  return { schema, pool, admin }
}

it('建站事务提交后为 siteId 初始化 knowledge 项目目录', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!
  const knowledgeRoot = inject('knowledgeDataRoot')
  const { pool, admin, schema } = await createIsolatedSchema(databaseUrl)
  try {
    const beforeSites = await pool.query('SELECT count(*)::int AS count FROM sites')
    const created = await createUnpublishedSite(
      { userId: 'owner', name: 'Knowledge Hook', settings: {}, sandboxId: randomUUID() },
      pool,
    )
    expect((await pool.query('SELECT count(*)::int AS count FROM sites')).rows[0].count).toBe(beforeSites.rows[0].count + 1)

    const purposeFile = path.join(knowledgeRoot, created.siteId, 'purpose.md')
    await fs.access(purposeFile)
    const getRes = await fetch(
      `${process.env.KNOWLEDGE_SERVICE_URL}/api/v1/projects/${created.siteId}`,
      { headers: { Authorization: `Bearer ${process.env.KNOWLEDGE_SERVICE_TOKEN}` } },
    )
    expect(getRes.status).toBe(200)
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA ${pg.escapeIdentifier(schema)} CASCADE`)
    await admin.end()
  }
})

it('knowledge_不可达时_fast_fail_并撤销已提交的站点行', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!
  const originalUrl = process.env.KNOWLEDGE_SERVICE_URL!
  const { pool, admin, schema } = await createIsolatedSchema(databaseUrl)
  process.env.KNOWLEDGE_SERVICE_URL = 'http://127.0.0.1:9'
  try {
    const beforeSites = await pool.query('SELECT count(*)::int AS count FROM sites')
    await expect(
      createUnpublishedSite({ userId: 'owner', name: 'Unreachable', settings: {}, sandboxId: randomUUID() }, pool),
    ).rejects.toBeInstanceOf(KnowledgeProjectBootstrapError)
    expect((await pool.query('SELECT count(*)::int AS count FROM sites')).rows[0].count).toBe(beforeSites.rows[0].count)
  } finally {
    process.env.KNOWLEDGE_SERVICE_URL = originalUrl
    await pool.end()
    await admin.query(`DROP SCHEMA ${pg.escapeIdentifier(schema)} CASCADE`)
    await admin.end()
  }
})
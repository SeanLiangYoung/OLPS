import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { expect, it } from 'vitest'
import { migrateWithClient } from './db-schema.js'
import { migrateCmsSchema } from './cms-schema.js'
import { cmsUpgradeVersion } from './cms-readiness.js'
import { upgradeCms } from './cms-upgrade.js'
import { createUnpublishedSite } from './site-lifecycle.js'

const execFileAsync = promisify(execFile)

const KNOWLEDGE_DOCUMENT_COLUMNS = [
  'asset_refs',
  'content',
  'created_at',
  'doc_id',
  'import_id',
  'kb_id',
  'kind',
  'source_document_id',
  'source_fingerprint',
  'source_path',
  'title',
  'updated_at',
  'wiki_path',
] as const

const KNOWLEDGE_ASSET_COLUMNS = [
  'asset_id',
  'byte_size',
  'caption',
  'created_at',
  'fingerprint',
  'height',
  'import_id',
  'kb_id',
  'mime_type',
  'promoted_media',
  'role',
  'role_confidence',
  'role_reason',
  'source_path',
  'storage_key',
  'updated_at',
  'width',
] as const

const KNOWLEDGE_IMPORT_COLUMNS = [
  'created_at',
  'draft_id',
  'error',
  'import_id',
  'site_id',
  'source_name',
  'stats',
  'status',
  'updated_at',
  'user_id',
] as const

async function columnNames(client: pg.PoolClient, table: string): Promise<string[]> {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1
     ORDER BY column_name`,
    [table],
  )
  return result.rows.map(row => String(row.column_name))
}

async function tableExists(client: pg.PoolClient, table: string): Promise<boolean> {
  const result = await client.query('SELECT to_regclass($1) AS name', [table])
  return Boolean(result.rows[0]?.name)
}

async function readKnowledgeRows(client: pg.PoolClient) {
  return {
    knowledge_documents: (
      await client.query(
        'SELECT to_jsonb(row_data) AS row FROM knowledge_documents AS row_data ORDER BY to_jsonb(row_data)::text',
      )
    ).rows,
    knowledge_assets: (
      await client.query(
        'SELECT to_jsonb(row_data) AS row FROM knowledge_assets AS row_data ORDER BY to_jsonb(row_data)::text',
      )
    ).rows,
    knowledge_imports: (
      await client.query(
        'SELECT to_jsonb(row_data) AS row FROM knowledge_imports AS row_data ORDER BY to_jsonb(row_data)::text',
      )
    ).rows,
  }
}

it('知识库投影表含扩展列与新表，CMS 迁移与升级可重复执行', async () => {
  const url = process.env.TEST_DATABASE_URL!
  if (!new URL(url).pathname.includes('_test_')) throw new Error('只允许专用测试数据库')
  const schema = `kb_proj_${randomUUID().replaceAll('-', '')}`
  const database = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const client = await database.connect()
  try {
    await migrateWithClient(client)
    await client.query("INSERT INTO users(user_id,account,password_hash,name,created_at,updated_at) VALUES('owner','owner','password','Owner',NOW(),NOW())")
    await migrateCmsSchema(client)

    expect(await columnNames(client, 'knowledge_documents')).toEqual([...KNOWLEDGE_DOCUMENT_COLUMNS])
    expect(await tableExists(client, 'knowledge_assets')).toBe(true)
    expect(await columnNames(client, 'knowledge_assets')).toEqual([...KNOWLEDGE_ASSET_COLUMNS])
    expect(await tableExists(client, 'knowledge_imports')).toBe(true)
    expect(await columnNames(client, 'knowledge_imports')).toEqual([...KNOWLEDGE_IMPORT_COLUMNS])

    const kindCheck = await client.query(
      `SELECT 1 FROM pg_constraint WHERE conrelid = 'knowledge_documents'::regclass AND conname = 'knowledge_documents_kind_check'`,
    )
    expect(kindCheck.rowCount).toBe(1)

    const dumpSchema = async () =>
      (
        await execFileAsync(
          'pg_dump',
          ['--dbname', url, '--schema', schema, '--schema-only', '--no-owner', '--no-privileges', '--restrict-key=OlpsKbProjection'],
          { maxBuffer: 8 * 1024 * 1024 },
        )
      ).stdout

    const schemaBefore = await dumpSchema()
    const rowsBefore = await readKnowledgeRows(client)
    await migrateCmsSchema(client)
    expect(await dumpSchema()).toBe(schemaBefore)
    expect(await readKnowledgeRows(client)).toEqual(rowsBefore)

    const created = await createUnpublishedSite(
      { userId: 'owner', name: 'Knowledge Site', settings: {}, sandboxId: randomUUID() },
      database,
    )
    const kb = (await client.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1', [created.siteId])).rows[0]
    const docId = randomUUID()
    await client.query(
      `INSERT INTO knowledge_documents(doc_id,kb_id,title,content,created_at)
       VALUES($1,$2,'手工资料','正文',NOW())`,
      [docId, kb.kb_id],
    )
    const manual = (await client.query('SELECT kind, asset_refs, updated_at IS NOT NULL AS has_updated FROM knowledge_documents WHERE doc_id=$1', [docId]))
      .rows[0]
    expect(manual.kind).toBe('manual')
    expect(manual.asset_refs).toEqual([])
    expect(manual.has_updated).toBe(true)

    await client.query(
      `INSERT INTO knowledge_documents(doc_id,kb_id,title,content,kind,source_path,wiki_path,asset_refs,created_at,updated_at)
       VALUES($1,$2,'Wiki','Wiki 正文','wiki_page','raw/a.md','wiki/a.md',$3::jsonb,NOW(),NOW())`,
      [randomUUID(), kb.kb_id, JSON.stringify([randomUUID()])],
    )
    expect((await client.query('SELECT count(*)::int AS count FROM knowledge_documents WHERE kb_id=$1', [kb.kb_id])).rows[0].count).toBe(2)

    client.release()

    expect(cmsUpgradeVersion).toBeGreaterThanOrEqual(2)
    await upgradeCms(database)
    const upgradeClient = await database.connect()
    try {
      expect(await columnNames(upgradeClient, 'knowledge_documents')).toEqual([...KNOWLEDGE_DOCUMENT_COLUMNS])
      const upgradeState = await upgradeClient.query('SELECT version, status FROM cms_upgrade_state WHERE singleton=TRUE')
      expect(upgradeState.rows[0]).toEqual({ version: cmsUpgradeVersion, status: 'completed' })
      const schemaAfterUpgrade = await dumpSchema()
      const rowsAfterUpgrade = await readKnowledgeRows(upgradeClient)
      await upgradeCms(database)
      expect(await dumpSchema()).toBe(schemaAfterUpgrade)
      expect(await readKnowledgeRows(upgradeClient)).toEqual(rowsAfterUpgrade)
    } finally {
      upgradeClient.release()
    }
  } finally {
    await database.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
}, 120000)
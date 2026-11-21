import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
import { expect, it } from 'vitest'
import { migrateWithClient } from './db-schema.js'
import { migrateCmsSchema } from './cms-schema.js'
import { createUnpublishedSite } from './site-lifecycle.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createCmsSite,copySiteKnowledgeDocument,initializeCmsSite } from './cms-sites.js'
import { loadSiteModel } from '@olps/render'
import { createFsSourceReader } from '@olps/site-builder'

it('CMS 升级可重复执行，网站创建事务完整并拒绝部分写入', async () => {
  const url = process.env.TEST_DATABASE_URL!
  if (!new URL(url).pathname.includes('_test_')) throw new Error('只允许专用测试数据库')
  const schema = `cms_${randomUUID().replaceAll('-','')}`
  const database = new pg.Pool({connectionString:url, options:`-c search_path=${schema}`})
  const admin = new pg.Client({connectionString:url})
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const client = await database.connect()
  const sandboxRoot = path.resolve('../../.intermediate/cms-site-tests',schema)
  try {
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    await client.query("INSERT INTO site_drafts(draft_id,name,sandbox_id,status,created_at,updated_at) VALUES('legacy','Legacy','legacy','active',NOW(),NOW())")
    await client.query("INSERT INTO draft_owners VALUES('legacy','owner',NOW())")
    await migrateCmsSchema(client)
    const first = await client.query('SELECT site_id FROM sites ORDER BY site_id')
    const dumpSchema = async () => (await promisify(execFile)('pg_dump', [
      '--dbname', url, '--schema', schema, '--schema-only', '--no-owner', '--no-privileges',
      '--restrict-key=OlpsSchemaAcceptance',
    ], { maxBuffer: 8 * 1024 * 1024 })).stdout
    const readRows = async () => {
      const tables = await client.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename', [schema])
      const rows: Record<string, unknown> = {}
      for (const { tablename } of tables.rows) {
        rows[tablename] = (await client.query(`SELECT to_jsonb(row_data) AS row FROM ${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(tablename)} AS row_data ORDER BY to_jsonb(row_data)::text`)).rows
      }
      return rows
    }
    const schemaBefore = await dumpSchema()
    const rowsBefore = await readRows()
    await migrateCmsSchema(client)
    expect(await dumpSchema()).toBe(schemaBefore)
    expect(await readRows()).toEqual(rowsBefore)
    expect((await client.query('SELECT site_id FROM sites ORDER BY site_id')).rows).toEqual(first.rows)
    expect((await client.query('SELECT * FROM site_drafts WHERE site_id IS NULL')).rows).toEqual([])
    const created = await createUnpublishedSite({userId:'owner', name:'New', settings:{}, sandboxId:randomUUID()},database)
    expect((await client.query('SELECT status FROM sites WHERE site_id=$1',[created.siteId])).rows[0].status).toBe('unpublished')
    expect((await client.query('SELECT * FROM knowledge_bases WHERE site_id=$1',[created.siteId])).rowCount).toBe(1)
    expect((await client.query('SELECT * FROM site_owners WHERE site_id=$1',[created.siteId])).rowCount).toBe(1)
    const count = await client.query('SELECT count(*) FROM sites')
    await expect(createUnpublishedSite({userId:'missing',name:'Failure',settings:{},sandboxId:randomUUID()},database)).rejects.toThrow()
    expect((await client.query('SELECT count(*) FROM sites')).rows).toEqual(count.rows)
    const snapshot = async () => {
      const result: Record<string, unknown> = {}
      for (const table of ['sites','site_owners','site_drafts','draft_owners','knowledge_bases']) {
        result[table] = (await client.query(`SELECT count(*) FROM ${table}`)).rows
      }
      return result
    }
    const beforeFailure = await snapshot()
    await expect(createUnpublishedSite({userId:'owner',name:'Failure',settings:{},sandboxId:'legacy'},database)).rejects.toThrow()
    expect(await snapshot()).toEqual(beforeFailure)
    expect((await client.query('SELECT site_id,count(*) FROM knowledge_bases WHERE site_id IS NOT NULL GROUP BY site_id HAVING count(*)<>1')).rows).toEqual([])
    await expect(client.query("INSERT INTO site_drafts(draft_id,name,sandbox_id,status,created_at,updated_at) VALUES('invalid','Invalid','invalid','active',NOW(),NOW())")).rejects.toThrow()
    const source = await createCmsSite('owner','Source',database,sandboxRoot)
    const targetA = await createCmsSite('owner','Target A',database,sandboxRoot)
    const targetB = await createCmsSite('owner','Target B',database,sandboxRoot)
    expect((await client.query('SELECT init_status FROM site_drafts WHERE draft_id=$1',[source.draftId])).rows[0].init_status).toBe('initializing')
    const invalidRoot = path.join(sandboxRoot,'invalid-root')
    await fs.mkdir(sandboxRoot,{recursive:true})
    await fs.writeFile(invalidRoot,'Cannot create a directory here')
    expect((await initializeCmsSite('owner',source.siteId,database,invalidRoot,'https://olps.example')).initStatus).toBe('failed')
    expect((await client.query('SELECT last_error FROM site_drafts WHERE draft_id=$1',[source.draftId])).rows[0].last_error).toBeTruthy()
    expect(await initializeCmsSite('owner',source.siteId,database,sandboxRoot,'https://olps.example')).toEqual({initStatus:'ready'})
    const draft = (await client.query('SELECT sandbox_id,init_status FROM site_drafts WHERE draft_id=$1',[source.draftId])).rows[0]
    expect(draft.init_status).toBe('ready')
    const model = await loadSiteModel(createFsSourceReader(path.join(sandboxRoot,draft.sandbox_id)))
    expect(model.pages).toHaveLength(8)
    expect(model.pages.flatMap(page => Object.keys(page.locales))).toHaveLength(16)
    expect(model.collections).toHaveLength(3)
    expect(Object.keys(model.plugins.plugins)).toHaveLength(3)
    const documentId = randomUUID()
    await client.query("INSERT INTO knowledge_documents(doc_id,kb_id,title,content,created_at) VALUES($1,$2,'Source','Original',NOW())",[documentId,source.knowledgeBaseId])
    const copies = await copySiteKnowledgeDocument('owner',source.siteId,documentId,[targetA.siteId,targetB.siteId],database)
    expect(new Set(copies.map(copy => copy.documentId)).size).toBe(2)
    await client.query("UPDATE knowledge_documents SET content='Changed' WHERE doc_id=$1",[documentId])
    expect((await client.query('SELECT content FROM knowledge_documents WHERE doc_id=ANY($1)',[copies.map(copy => copy.documentId)])).rows).toEqual([{content:'Original'},{content:'Original'}])
  } finally {
    client.release()
    await database.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
    await fs.rm(sandboxRoot,{recursive:true,force:true})
  }
},120000)

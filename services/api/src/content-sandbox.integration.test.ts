import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { expect, it } from 'vitest'
import { SyncWorkspace } from '@olps/sync'
import { migrateWithClient } from './db.js'
import { migrateCmsSchema } from './cms-schema.js'
import { createCmsSite, initializeCmsSite } from './cms-sites.js'
import { createContentIndexSchema } from './content-index.js'
import { createContent, readContent, saveContent, deleteContent, reorderContent, listContent } from './content-sandbox.js'

it('内容文件与真实数据库同步，revision并发拒绝陈旧保存', async () => {
  const url = process.env.TEST_DATABASE_URL!
  if (!new URL(url).pathname.includes('_test_')) throw new Error('只允许测试数据库')
  const schema = `content_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const database = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
  const client = await database.connect()
  const sandboxRoot = path.resolve('.intermediate/content-tests', randomUUID())
  try {
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    await migrateCmsSchema(client)
    await createContentIndexSchema(client)
    const site = await createCmsSite('owner', 'Content', database, sandboxRoot)
    expect(await initializeCmsSite('owner', site.siteId, database, sandboxRoot)).toEqual({ initStatus: 'ready' })
    const draft = (await client.query('SELECT sandbox_id,head_commit_id FROM site_drafts WHERE draft_id=$1', [site.draftId])).rows[0]
    const workspace = await SyncWorkspace.open({ sandboxRoot, draftId: draft.sandbox_id, remote: { baseUrl: process.env.REMOTE_SERVICE_URL!, token: process.env.REMOTE_SERVICE_TOKEN! }, baseCommitId: draft.head_commit_id, headCommitId: draft.head_commit_id })
    const context = { database, workspace, draftId: site.draftId, userId: 'owner' }
    const now = new Date().toISOString()
    const pageId = randomUUID()
    const content = { ref: 'page' as const, meta: { schemaVersion: 1, pageId, role: null, template: 'page', status: 'draft', createdAt: now, updatedAt: now }, locale: { schemaVersion: 1, locale: 'en', slug: 'article', title: 'Article', summary: '', cover: null, seo: { title: 'Article', description: '', ogImage: null }, blocks: [], sourceHash: null, updatedAt: now } }
    const created = await createContent(context, content)
    expect((await readContent(context, 'page', pageId, 'en')).revision).toBe(created.revision)
    const changed = structuredClone(content)
    changed.locale.title = 'Updated'
    const results = await Promise.allSettled([saveContent(context, pageId, changed, created.revision), saveContent(context, pageId, changed, created.revision)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const current = await readContent(context, 'page', pageId, 'en')
    expect(current.content.locale.title).toBe('Updated')
    expect((await client.query('SELECT title FROM pages WHERE page_id=$1', [pageId])).rows[0].title).toBe('Updated')
    await deleteContent(context, 'page', pageId, current.revision)
    await expect(readContent(context, 'page', pageId, 'en')).rejects.toThrow('NOT_FOUND')
    const collectionId = randomUUID()
    const levelId = randomUUID()
    const { slug: _slug, ...indexLocale } = content.locale
    const collection = { ref: 'collection' as const, meta: { schemaVersion:1,collectionId,name:'Products',labels:{en:'Products'},prefix:'products',status:'draft',levels:[{levelId,name:'Series'}],fields:[{key:'code',type:'text',label:'Code',translatable:false,required:false}],structuredData:null,feed:false,createdAt:now,updatedAt:now },locale:indexLocale }
    const collectionCreated = await createContent(context,collection)
    expect((await readContent(context,'collection',collectionId,'en')).revision).toBe(collectionCreated.revision)
    const groupId = randomUUID()
    const group = {ref:'group' as const,collectionId,meta:{schemaVersion:1,groupId,parentGroupId:null,levelId,order:0,status:'draft',createdAt:now,updatedAt:now},locale:{...content.locale,slug:'series'}}
    const groupCreated = await createContent(context,group)
    const itemId = randomUUID()
    const item = {ref:'item' as const,collectionId,meta:{schemaVersion:1,itemId,primaryGroupId:groupId,groupIds:[groupId],order:0,publishedAt:null,status:'draft',fields:{},createdAt:now,updatedAt:now},locale:{...content.locale,slug:'product',fields:{}}}
    const itemCreated = await createContent(context,item)
    await expect(deleteContent(context,'group',groupId,groupCreated.revision)).rejects.toThrow('RESOURCE_IN_USE')
    await expect(deleteContent(context,'collection',collectionId,collectionCreated.revision)).rejects.toThrow('RESOURCE_IN_USE')
    await expect(saveContent(context,collectionId,{...collection,meta:{...collection.meta,levels:[]}},collectionCreated.revision)).rejects.toThrow('RESOURCE_IN_USE')
    for(const fields of [[],[{...collection.meta.fields[0],type:'number'}],[{...collection.meta.fields[0],translatable:true}],[{...collection.meta.fields[0],type:'reference',referenceCollectionId:randomUUID()}]]) {
      await expect(saveContent(context,collectionId,{...collection,meta:{...collection.meta,fields}},collectionCreated.revision)).rejects.toMatchObject({
        code:'RESOURCE_IN_USE',
        details:{groupCount:1,itemCount:1,objects:expect.arrayContaining([{ref:'group',id:groupId},{ref:'item',id:itemId}])},
      })
    }
    const updatedItem = await saveContent(context,itemId,{...item,locale:{...item.locale,title:'Updated item',slug:'product-two'}},itemCreated.revision)
    expect((await readContent(context,'item',itemId,'en')).content.locale.title).toBe('Updated item')
    const redirects = JSON.parse((await workspace.readFile('source/redirects.json')).toString())
    expect(redirects.redirects).toContainEqual(expect.objectContaining({from:'/en/products/product/',target:{ref:'item',id:itemId}}))
    const updatedGroup = await saveContent(context,groupId,{...group,locale:{...group.locale,title:'Updated group'}},groupCreated.revision)
    expect((await readContent(context,'group',groupId,'en')).content.locale.title).toBe('Updated group')
    const snapshot = async () => {
      const data: Record<string,unknown> = {}
      for (const table of ['pages','collection_indexes','collection_groups','collection_items']) data[table] = (await client.query(`SELECT * FROM ${table} ORDER BY draft_id,locale`)).rows
      const files: Record<string,string> = {}
      for (const file of await workspace.listFiles('source')) files[file] = (await workspace.readFile(file)).toString('base64')
      return {data,files}
    }
    await client.query("ALTER TABLE collection_items ADD CONSTRAINT test_title CHECK(title<>'REJECTED')")
    const beforeFailure = await snapshot()
    await expect(saveContent(context,itemId,{...item,locale:{...item.locale,title:'REJECTED'}},updatedItem.revision)).rejects.toThrow()
    expect(await snapshot()).toEqual(beforeFailure)
    const reordered = await reorderContent(context,collectionId,'item',[{id:itemId,order:2}],collectionCreated.revision)
    await expect(reorderContent(context,collectionId,'item',[{id:itemId,order:3}],collectionCreated.revision)).rejects.toThrow('REVISION_CONFLICT')
    const reorderedItem = await readContent(context,'item',itemId,'en')
    expect(reorderedItem.content.meta.order).toBe(2)
    expect((await listContent(context,'item',{locale:'en',collectionId})).contents).toHaveLength(1)
    await deleteContent(context,'item',itemId,reorderedItem.revision)
    await deleteContent(context,'group',groupId,updatedGroup.revision)
    const updatedCollection = await saveContent(context,collectionId,{...collection,locale:{...collection.locale,title:'Updated collection'}},reordered.revision)
    await deleteContent(context,'collection',collectionId,updatedCollection.revision)
  } finally {
    client.release()
    await database.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
    await fs.rm(sandboxRoot, { recursive: true, force: true })
  }
}, 120000)

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { expect,it } from 'vitest'
import { migrateWithClient } from './db-schema.js'
import { migrateCmsRuntime } from './cms-runtime-schema.js'
import { cmsBusinessCounts } from './cms-migration.js'
import { initializeLegacySiteSandbox,type LegacyPageRow } from './cms-legacy-sandbox.js'
import { loadWorkspace } from '@olps/site-builder'
import { decryptCredential } from './credentials.js'
import { createFullLegacyTenantSchema } from './test-support/legacy-schema.js'
import { migrateToCollaborationModel,legacySitesHaveTenantId } from './migrate.js'

it('旧网站真实文件迁移保留业务记录，恢复索引并保持重复执行结果',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许专用测试数据库')
  const schema=`migration_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const root=path.resolve('../../.intermediate/cms-migration-tests',schema)
  const sandboxId=randomUUID(),draftId=randomUUID(),siteId=randomUUID(),userId=randomUUID(),pageId=randomUUID(),kbId=randomUUID()
  const options={sandboxRoot:root,validationRoot:path.join(root,'validation'),publicApiBaseUrl:'https://olps.example'}
  const html='<article data-legacy="yes"><h1>Existing company</h1><p>Existing description</p></article>'
  const page:LegacyPageRow={page_id:pageId,site_id:siteId,kind:'landing',slug:'company',title:'Existing company',status:'published',locale:'en',seo:{title:'Existing company',description:'Existing description'},body:{html},created_at:new Date('2026-01-01'),updated_at:new Date('2026-01-01'),published_at:null}
  try{
    const client=await database.connect();await migrateWithClient(client);client.release()
    await database.query("INSERT INTO users VALUES($1,$1,'password','Owner',NOW(),NOW())",[userId])
    await database.query("INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES($1,'Legacy','{}',NOW(),NOW())",[siteId])
    await database.query('INSERT INTO site_owners VALUES($1,$2,NOW())',[siteId,userId])
    const invalidCounts=await cmsBusinessCounts(database)
    await expect(initializeLegacySiteSandbox({legacySiteId:siteId,draftId,sandboxId,pendingSiteId:siteId,siteName:'Legacy',settings:{},pages:[{...page,page_id:'invalid-page'}],skipIfPresent:false},root)).rejects.toThrow('旧页面标识')
    expect(await cmsBusinessCounts(database)).toEqual(invalidCounts)
    expect(await fs.stat(root).catch(error=>{if(error.code==='ENOENT')return null;throw error})).toBeNull()
    const prepared=await initializeLegacySiteSandbox({legacySiteId:siteId,draftId,sandboxId,pendingSiteId:siteId,siteName:'Legacy',settings:{defaultLocale:'en',mapsEnabled:true,mapsApiKey:'private-legacy-value'},pages:[page],skipIfPresent:false},root)
    await database.query("INSERT INTO site_drafts(draft_id,site_id,name,sandbox_id,status,head_commit_id,base_commit_id,created_at,updated_at) VALUES($1,$2,'Legacy',$3,'active',$4,$4,NOW(),NOW())",[draftId,siteId,sandboxId,prepared.headCommitId])
    await database.query('INSERT INTO draft_owners VALUES($1,$2,NOW())',[draftId,userId])
    await database.query("INSERT INTO inquiries(draft_id,payload) VALUES($1,'{}')",[draftId])
    await database.query("INSERT INTO reports VALUES($1,$2,NULL,$3,$4,88,'[]',NOW())",[randomUUID(),userId,draftId,pageId])
    await database.query("INSERT INTO jobs VALUES($1,$2,$3,NULL,'seo','completed','{}','{}',NULL,NOW(),NOW())",[randomUUID(),userId,draftId])
    await database.query("INSERT INTO knowledge_bases VALUES($1,$2,'Legacy documents',NOW(),NOW())",[kbId,userId])
    await database.query("INSERT INTO knowledge_documents VALUES($1,$2,'Company','Existing knowledge',NOW())",[randomUUID(),kbId])
    const before=await cmsBusinessCounts(database)
    await migrateCmsRuntime(database,options)
    expect(await cmsBusinessCounts(database)).toEqual(before)
    const workspace=path.join(root,sandboxId)
    const git=(args:string[])=>execFileSync('git',args,{cwd:workspace,encoding:'utf8'}).trim()
    const head=git(['rev-parse','HEAD'])
    expect(git(['rev-list','--count','HEAD'])).toBe('2')
    expect((await loadWorkspace(workspace)).model.pages.find(item=>item.meta.pageId===pageId)!.locales.en!.blocks[0]!.props.html).toBe(html)
    execFileSync('node',['tools/site-verify.mjs'],{cwd:workspace})
    for(const table of ['inquiries','reports','jobs'])expect((await database.query(`SELECT site_id FROM ${table}`)).rows).toEqual([{site_id:siteId}])
    const credential=(await database.query('SELECT ciphertext FROM plugin_secrets')).rows[0].ciphertext
    expect(credential).not.toContain('private-legacy-value')
    expect(JSON.parse(decryptCredential(credential,`${siteId}/google-maps`))).toEqual({apiKey:'private-legacy-value'})
    expect((await database.query('SELECT d.content FROM knowledge_documents d JOIN knowledge_bases k USING(kb_id) WHERE k.site_id=$1',[siteId])).rows).toEqual([{content:'Existing knowledge'}])
    await database.query('DELETE FROM pages WHERE draft_id=$1',[draftId])
    await database.query('UPDATE site_drafts SET head_commit_id=$1 WHERE draft_id=$2',[prepared.headCommitId,draftId])
    await migrateCmsRuntime(database,options)
    expect((await database.query('SELECT page_id FROM pages WHERE draft_id=$1 AND page_id=$2',[draftId,pageId])).rowCount).toBe(1)
    expect(git(['rev-parse','HEAD'])).toBe(head)
    const state=async()=>{const result:Record<string,unknown>={};for(const table of ['sites','site_drafts','pages','knowledge_documents','plugin_secrets','cms_knowledge_migrations'])result[table]=(await database.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows;return result}
    const snapshot=await state();await migrateCmsRuntime(database,options)
    expect(await state()).toEqual(snapshot)
    expect(git(['rev-parse','HEAD'])).toBe(head)
    expect(git(['status','--porcelain'])).toBe('')
  }finally{await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})}
},120000)

it('旧页面标识无效时准备操作保留文件与数据库',async()=>{
  const root=path.resolve('../../.intermediate/cms-migration-tests',randomUUID())
  const input={legacySiteId:randomUUID(),draftId:randomUUID(),sandboxId:randomUUID(),pendingSiteId:randomUUID(),siteName:'Legacy',settings:{},pages:[{page_id:'invalid-page'} as LegacyPageRow],skipIfPresent:false}
  try{for(const pageId of ['invalid-page','-'.repeat(36),'f'.repeat(36)]){
    await expect(initializeLegacySiteSandbox({...input,pages:[{page_id:pageId} as LegacyPageRow]},root)).rejects.toThrow('旧页面标识')
    expect(await fs.stat(root).catch(error=>{if(error.code==='ENOENT')return null;throw error})).toBeNull()
  }}finally{await fs.rm(root,{recursive:true,force:true})}
})

it('准备目录校验拒绝源数据变化、缺少页面、额外文件和符号链接',async()=>{
  const root=path.resolve('../../.intermediate/cms-migration-tests',randomUUID())
  const now=new Date('2026-01-01')
  const input={legacySiteId:randomUUID(),draftId:randomUUID(),sandboxId:randomUUID(),pendingSiteId:randomUUID(),siteName:'Legacy',settings:{defaultLocale:'en'},pages:[{page_id:randomUUID(),site_id:randomUUID(),kind:'site',slug:'home',title:'Home',status:'published',locale:'en',seo:{title:'Home',description:'Home'},body:{html:'<h1>Home</h1>'},created_at:now,updated_at:now,published_at:null}],skipIfPresent:true}
  try{
    const prepared=await initializeLegacySiteSandbox(input,root)
    expect(await initializeLegacySiteSandbox(input,root)).toEqual(prepared)
    await expect(initializeLegacySiteSandbox({...input,pages:[{...input.pages[0]!,body:{html:'<h1>Changed</h1>'}}]},root)).rejects.toThrow('迁移输入已变化')
    for(const mutation of ['missing','extra','changed','symlink']){
      const variant={...input,sandboxId:randomUUID()}
      await initializeLegacySiteSandbox(variant,root)
      const workspace=path.join(root,variant.sandboxId)
      const original=path.join(workspace,'source/pages',`${input.pages[0]!.page_id}.json`)
      if(mutation==='missing')await fs.rm(original)
      if(mutation==='extra'){await fs.mkdir(path.join(workspace,'public'));await fs.writeFile(path.join(workspace,'public/index.html'),'<h1>Extra</h1>')}
      if(mutation==='changed')await fs.writeFile(original,JSON.stringify({...input.pages[0],body:{html:'<h1>Changed</h1>'}}))
      if(mutation==='symlink')await fs.symlink(root,path.join(workspace,'external'))
      if(mutation!=='symlink'){
        execFileSync('git',['add','-A'],{cwd:workspace})
        execFileSync('git',['-c','user.name=OLPS','-c','user.email=olps@localhost','commit','-m','更新测试内容'],{cwd:workspace})
      }
      const head=execFileSync('git',['rev-parse','HEAD'],{cwd:workspace,encoding:'utf8'})
      await expect(initializeLegacySiteSandbox(variant,root)).rejects.toThrow(mutation==='symlink'?'符号链接':'迁移目录文件')
      expect(execFileSync('git',['rev-parse','HEAD'],{cwd:workspace,encoding:'utf8'})).toBe(head)
    }
  }finally{await fs.rm(root,{recursive:true,force:true})}
})

it('真实租户数据库迁移保留全部业务记录与序列，失败重试后完成CMS转换',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许专用测试数据库')
  const schema=`tenant_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const root=path.resolve('../../.intermediate/cms-migration-tests',schema)
  const oldSiteOwners=process.env.MIGRATION_SITE_OWNERS,oldKbOwners=process.env.MIGRATION_KB_OWNERS
  try{
    await createFullLegacyTenantSchema(database)
    await database.query("UPDATE site_integrations SET ads_account_id='1234567890',ads_connected=TRUE,ga_property_id='properties/123456',ga_connected=TRUE")
    await database.query('CREATE TABLE users(user_id TEXT PRIMARY KEY,account TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,name TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL)')
    const userId=randomUUID()
    await database.query("INSERT INTO users VALUES($1,'legacy-owner','password','Owner',NOW(),NOW())",[userId])
    process.env.MIGRATION_SITE_OWNERS=JSON.stringify({'legacy-site-1':['legacy-owner']})
    process.env.MIGRATION_KB_OWNERS=JSON.stringify({'legacy-kb-1':['legacy-owner']})
    const before:Record<string,number>={}
    for(const table of ['users','sites','inquiries','reports','jobs','knowledge_documents'])before[table]=Number((await database.query(`SELECT count(*) FROM ${table}`)).rows[0].count)
    const oldPages=(await database.query('SELECT * FROM pages ORDER BY page_id')).rows
    await expect(migrateToCollaborationModel(database,{sandboxRoot:root})).rejects.toThrow('旧页面标识')
    expect(await legacySitesHaveTenantId(database)).toBe(true)
    expect((await database.query('SELECT * FROM pages ORDER BY page_id')).rows).toEqual(oldPages)
    for(const oldPage of oldPages){
      const newId=randomUUID()
      await database.query('UPDATE pages SET page_id=$1 WHERE page_id=$2',[newId,oldPage.page_id])
      for(const table of ['inquiries','reports','analytics_events'])await database.query(`UPDATE ${table} SET page_id=$1 WHERE page_id=$2`,[newId,oldPage.page_id])
    }
    const pageIds=(await database.query('SELECT page_id FROM pages ORDER BY page_id')).rows.map(row=>row.page_id)
    const legacyTables=['sites','pages','inquiries','inquiry_email_outbox','knowledge_bases','knowledge_documents','jobs','site_integrations','reports','analytics_events']
    const legacySnapshot:Record<string,Array<Record<string,unknown>>>={}
    for(const table of legacyTables)legacySnapshot[table]=(await database.query(`SELECT * FROM ${table} ORDER BY 1`)).rows
    const sequences=['inquiries_inquiry_id_seq','inquiry_email_outbox_outbox_id_seq','analytics_events_event_id_seq']
    const serials:Record<string,unknown>={}
    for(const sequence of sequences)serials[sequence]=(await database.query(`SELECT last_value,is_called FROM ${sequence}`)).rows
    const blocker=await database.connect()
    await blocker.query('BEGIN');await blocker.query('LOCK TABLE sites IN ACCESS SHARE MODE')
    let completed=false
    const migrating=migrateToCollaborationModel(database,{sandboxRoot:root}).finally(()=>{completed=true})
    try{
      let waiting=false
      const deadline=Date.now()+5000
      while(Date.now()<deadline && !waiting){
        waiting=Boolean((await database.query("SELECT 1 FROM pg_locks WHERE relation='sites'::regclass AND mode='AccessExclusiveLock' AND NOT granted")).rowCount)
        if(!waiting)await new Promise(resolve=>setTimeout(resolve,20))
      }
      expect(waiting).toBe(true);expect(completed).toBe(false)
      expect((await blocker.query('SELECT * FROM sites')).rowCount).toBe(1)
    }finally{await blocker.query('ROLLBACK');blocker.release()}
    await migrating
    for(const table of legacyTables){
      const destination=table==='sites'?'site_drafts':table
      const actual=(await database.query(`SELECT * FROM ${destination} ORDER BY 1`)).rows
      expect(actual).toHaveLength(legacySnapshot[table]!.length)
      for(let index=0;index<actual.length;index++)for(const [column,value] of Object.entries(legacySnapshot[table]![index]!)){
        const expectedRow=legacySnapshot[table]![index]!,primary=Object.keys(expectedRow)[0]!
        const actualRow=primary==='site_id'?actual[index]:actual.find(row=>row[primary]===expectedRow[primary])
        expect(actualRow,`${table}主键记录`).toBeDefined()
        if(column==='tenant_id' || column==='site_id')continue
        if(table==='sites' && column==='settings'){
          const settings=JSON.parse(await fs.readFile(path.join(root,actualRow.sandbox_id,'source/site-settings.json'),'utf8'))
          const {mapsApiKey,...expected}=value as Record<string,unknown>
          expect(settings).toMatchObject(expected);expect(settings.mapsApiKey).toBeUndefined();continue
        }
        expect(actualRow[column],`${table}.${column}`).toEqual(value)
      }
    }
    for(const sequence of sequences)expect((await database.query(`SELECT last_value,is_called FROM ${sequence}`)).rows).toEqual(serials[sequence])
    await migrateCmsRuntime(database,{sandboxRoot:root,validationRoot:path.join(root,'validation'),publicApiBaseUrl:'https://olps.example'})
    for(const [table,count] of Object.entries(before))expect(Number((await database.query(`SELECT count(*) FROM ${table}`)).rows[0].count)).toBe(count)
    expect((await database.query('SELECT * FROM site_drafts')).rowCount).toBe(before.sites)
    expect((await database.query('SELECT page_id FROM pages WHERE page_id=ANY($1) ORDER BY page_id',[pageIds])).rows.map(row=>row.page_id)).toEqual(pageIds)
    const draft=(await database.query('SELECT * FROM site_drafts')).rows[0]
    expect((await database.query('SELECT connector,status,account_id,public_config FROM integration_connections ORDER BY connector')).rows).toEqual([{connector:'ga4',status:'needs_reconnect',account_id:'properties/123456',public_config:{}},{connector:'googleAds',status:'needs_reconnect',account_id:'1234567890',public_config:{}}])
    const workspace=path.join(root,draft.sandbox_id)
    execFileSync('node',['tools/site-verify.mjs'],{cwd:workspace})
    expect((await loadWorkspace(workspace)).model.pages.filter(page=>pageIds.includes(page.meta.pageId))).toHaveLength(2)
    expect((await database.query("INSERT INTO inquiries(draft_id,site_id,payload) VALUES($1,$2,'{}') RETURNING inquiry_id",[draft.draft_id,draft.site_id])).rows[0].inquiry_id).toBe('2')
    const counts=await cmsBusinessCounts(database)
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:workspace,encoding:'utf8'}).trim()
    await migrateToCollaborationModel(database,{sandboxRoot:root})
    await migrateCmsRuntime(database,{sandboxRoot:root,validationRoot:path.join(root,'validation')})
    expect(await cmsBusinessCounts(database)).toEqual(counts)
    expect(execFileSync('git',['rev-parse','HEAD'],{cwd:workspace,encoding:'utf8'}).trim()).toBe(head)
  }finally{
    if(oldSiteOwners===undefined)delete process.env.MIGRATION_SITE_OWNERS;else process.env.MIGRATION_SITE_OWNERS=oldSiteOwners
    if(oldKbOwners===undefined)delete process.env.MIGRATION_KB_OWNERS;else process.env.MIGRATION_KB_OWNERS=oldKbOwners
    await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})
  }
},120000)

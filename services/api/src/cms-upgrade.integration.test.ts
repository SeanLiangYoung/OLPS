import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { expect,it } from 'vitest'
import { migrateWithClient } from './db-schema.js'
import { initializeLegacySiteSandbox } from './cms-legacy-sandbox.js'
import { loadWorkspace } from '@olps/site-builder'
import ts from 'typescript'

it('生产启动的模块依赖不包含旧格式转换与升级程序',()=>{
  const program=ts.createProgram({rootNames:[path.resolve('src/server.ts')],options:{module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext}})
  const sources=program.getSourceFiles().filter(file=>!file.isDeclarationFile&&!file.fileName.includes('/node_modules/'))
  expect(sources.some(file=>file.fileName.endsWith('/server.ts'))).toBe(true)
  for(const file of ['db-schema.ts','migrate.ts','cms-upgrade.ts','cms-runtime-schema.ts','cms-migration.ts','content-conversion.ts','cms-legacy-sandbox.ts','cms-legacy-inquiries.ts']){
    expect(sources.some(source=>source.fileName.endsWith(`/${file}`)),file).toBe(false)
  }
  const forbidden:string[]=[]
  const inspect=(node:ts.Node):void=>{
    if(ts.isIdentifier(node)&&['PageKind','PageBody','StoredPageJson'].includes(node.text))forbidden.push(node.text)
    if(ts.isPropertyAccessExpression(node)&&node.name.text==='html'&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='body')forbidden.push(node.getText())
    if(ts.isPropertyAccessExpression(node)&&node.name.text==='kind'&&ts.isIdentifier(node.expression)&&node.expression.text==='page')forbidden.push(node.getText())
    if(ts.isStringLiteral(node)&&/\/pages\/[^\s]*\/preview/.test(node.text))forbidden.push(node.text)
    if(ts.isStringLiteralLike(node)&&/CREATE TABLE IF NOT EXISTS (pages|site_published_pages)\b/.test(node.text))forbidden.push('旧页面结构初始化')
    ts.forEachChild(node,inspect)
  }
  for(const source of sources)inspect(source)
  expect(forbidden).toEqual([])
})

it('服务只检查升级完成状态，独立命令转换旧网站且重复执行保持内容版本',async()=>{
  const schema=`upgrade_${randomUUID().replaceAll('-','')}`
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许专用测试数据库')
  const admin=new pg.Client({connectionString:url});await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const root=path.resolve('../../.intermediate/cms-upgrade-tests',schema)
  const run=async(file:string)=>{
    const child=spawn(process.execPath,['--import','tsx',path.resolve('src',file)],{env:{...process.env,DATABASE_URL:url,PG_TEST_SCHEMA:schema,PORT:'0',SANDBOX_ROOT:root,PREVIEW_ROOT:path.join(root,'preview'),PUBLISH_ROOT:path.join(root,'publish')},stdio:['ignore','pipe','pipe']})
    let stdout='',stderr='',health:unknown
    let checking=false
    child.stdout.on('data',async chunk=>{
      stdout+=String(chunk)
      const address=/OLPS API listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout)?.[1]
      if(!address||checking)return
      checking=true
      try{
        const response=await fetch(`${address}/api/health`)
        health={status:response.status,body:await response.json()}
      }catch(error){stderr+=String(error)}finally{child.kill('SIGTERM')}
    })
    child.stderr.on('data',chunk=>{stderr+=String(chunk)})
    const timer=setTimeout(()=>child.kill('SIGTERM'),20000)
    try{const [code]=await once(child,'exit');return {code,stdout,stderr,health}}finally{clearTimeout(timer)}
  }
  try{
    const empty=await run('server.ts')
    expect(empty.stderr).toContain('npm run upgrade -w @olps/api')
    expect(empty.code).toBe(1)
    expect((await database.query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[schema])).rows).toEqual([])
    expect((await run('upgrade.ts')).code).toBe(0)
    expect((await run('server.ts')).health).toEqual({status:200,body:{ok:true}})
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.query(`CREATE SCHEMA ${schema}`)
    const client=await database.connect();await migrateWithClient(client);client.release()
    const userId=randomUUID(),siteId=randomUUID(),draftId=randomUUID(),sandboxId=randomUUID(),pageId=randomUUID()
    await database.query("INSERT INTO users VALUES($1,$1,'password','Owner',NOW(),NOW())",[userId])
    await database.query("INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES($1,'Legacy','{}',NOW(),NOW())",[siteId])
    await database.query('INSERT INTO site_owners VALUES($1,$2,NOW())',[siteId,userId])
    const prepared=await initializeLegacySiteSandbox({legacySiteId:siteId,draftId,sandboxId,pendingSiteId:siteId,siteName:'Legacy',settings:{},pages:[{page_id:pageId,site_id:siteId,kind:'landing',slug:'legacy',title:'Legacy',status:'published',locale:'en',seo:{title:'Legacy',description:''},body:{html:'<h1>Legacy upgrade</h1>'},created_at:new Date(),updated_at:new Date(),published_at:null}],skipIfPresent:false},root)
    await database.query("INSERT INTO site_drafts(draft_id,site_id,name,sandbox_id,status,head_commit_id,base_commit_id,created_at,updated_at) VALUES($1,$2,'Legacy',$3,'active',$4,$4,NOW(),NOW())",[draftId,siteId,sandboxId,prepared.headCommitId])
    await database.query('INSERT INTO draft_owners VALUES($1,$2,NOW())',[draftId,userId])
    const file=path.join(root,sandboxId,'source/pages',`${pageId}.json`)
    const before=await fs.readFile(file,'utf8')
    const draftBefore=(await database.query('SELECT * FROM site_drafts')).rows
    const unready=await run('server.ts')
    expect(unready.code).toBe(1)
    expect(await fs.readFile(file,'utf8')).toBe(before)
    expect((await database.query('SELECT * FROM site_drafts')).rows).toEqual(draftBefore)
    await fs.writeFile(file,JSON.stringify({...JSON.parse(before),pageId:'invalid-page'}))
    const failed=await run('upgrade.ts')
    expect(failed.code).toBe(1)
    expect((await database.query('SELECT status FROM cms_upgrade_state')).rows).toEqual([{status:'running'}])
    expect((await run('server.ts')).code).toBe(1)
    await fs.writeFile(file,before)
    const upgraded=await run('upgrade.ts')
    expect(upgraded.stderr).toBe('')
    expect(upgraded.code,upgraded.stdout).toBe(0)
    const model=(await loadWorkspace(path.join(root,sandboxId))).model
    expect(model.pages.find(page=>page.meta.pageId===pageId)!.locales.en.blocks[0].props.html).toBe('<h1>Legacy upgrade</h1>')
    const upgradedDraft=(await database.query('SELECT * FROM site_drafts')).rows
    const upgradeState=(await database.query('SELECT *,xmin::text AS row_version FROM cms_upgrade_state')).rows
    expect((await run('upgrade.ts')).code).toBe(0)
    expect((await database.query('SELECT * FROM site_drafts')).rows).toEqual(upgradedDraft)
    const locked=await database.connect()
    try{
      await locked.query("SELECT pg_advisory_lock(hashtext('olps-cms-upgrade'))")
      const concurrent=await run('upgrade.ts')
      expect(concurrent.code).toBe(1)
      expect(concurrent.stderr).toContain('网站升级命令正在运行')
      expect((await database.query('SELECT *,xmin::text AS row_version FROM cms_upgrade_state')).rows).toEqual(upgradeState)
    }finally{await locked.query("SELECT pg_advisory_unlock(hashtext('olps-cms-upgrade'))");locked.release()}
    expect((await database.query('SELECT *,xmin::text AS row_version FROM cms_upgrade_state')).rows).toEqual(upgradeState)
    const ready=await run('server.ts')
    expect(ready.stdout).toContain('OLPS API listening')
    expect(ready.health).toEqual({status:200,body:{ok:true}})
    expect((await database.query('SELECT * FROM site_drafts')).rows).toEqual(upgradedDraft)
    await database.query("UPDATE cms_upgrade_state SET status='running'")
    expect((await run('server.ts')).code).toBe(1)
    await database.query("UPDATE cms_upgrade_state SET version=2,status='completed'")
    const newer=(await database.query('SELECT *,xmin::text AS row_version FROM cms_upgrade_state')).rows
    expect((await run('upgrade.ts')).code).toBe(1)
    expect((await database.query('SELECT *,xmin::text AS row_version FROM cms_upgrade_state')).rows).toEqual(newer)
  }finally{await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})}
},120000)

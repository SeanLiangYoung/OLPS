import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID,randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { afterEach,expect,it } from 'vitest'
import { loadWorkspace,verifySite } from '@olps/site-builder'
import { convertLegacyContent } from './content-conversion.js'
import sharp from 'sharp'
import pg from 'pg'
import { migrateWithClient } from './db.js'
import { migrateCmsSchema } from './cms-schema.js'
import { createUnpublishedSite } from './site-lifecycle.js'
import { decryptCredential,encryptCredential } from './credentials.js'

let root:string
let database:pg.Pool|undefined
let admin:pg.Client|undefined
let schema:string
const originalKey=process.env.CREDENTIALS_ENCRYPTION_KEY
afterEach(async()=>{
  if(root) await fs.rm(root,{recursive:true,force:true})
  await database?.end();database=undefined
  if(admin) {await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();admin=undefined}
  if(originalKey===undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
  else process.env.CREDENTIALS_ENCRYPTION_KEY=originalKey
})
it('旧页面与真实媒体转换、独立验证和重复运行保持同一个Git提交',async()=>{
  const parent=path.resolve('../../.intermediate/content-conversion-tests')
  await fs.mkdir(parent,{recursive:true})
  root=await fs.mkdtemp(path.join(parent,'conversion-'))
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_')) throw new Error('只允许测试数据库')
  schema=`conversion_${randomUUID().replaceAll('-','')}`
  admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const client=await database.connect()
  await migrateWithClient(client);await migrateCmsSchema(client)
  const userId=randomUUID()
  await client.query("INSERT INTO users VALUES($1,$1,'password','Owner',NOW(),NOW())",[userId])
  client.release()
  const site=await createUnpublishedSite({userId,name:'Legacy',settings:{},sandboxId:randomUUID()},database)
  process.env.CREDENTIALS_ENCRYPTION_KEY=randomBytes(32).toString('base64')
  const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim()
  git(['init','-b','main'])
  await fs.mkdir(path.join(root,'source/pages'),{recursive:true})
  await fs.mkdir(path.join(root,'assets/images'),{recursive:true})
  await fs.mkdir(path.join(root,'assets/css'),{recursive:true})
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="blue"/></svg>'
  await fs.writeFile(path.join(root,'assets/images/a.svg'),svg)
  await fs.writeFile(path.join(root,'assets/images/a.png'),await sharp({create:{width:32,height:24,channels:3,background:'blue'}}).png().toBuffer())
  await fs.writeFile(path.join(root,'assets/css/a.css'),'.picture{background-image:url("../images/a.svg")}')
  const secret='legacy-maps-private-key'
  await fs.writeFile(path.join(root,'source/site-settings.json'),JSON.stringify({defaultLocale:'en',mapsEnabled:true,mapsApiKey:secret,whatsappEnabled:true,whatsappNumber:'123456789',whatsappLabel:'Contact'}))
  const raw='<section data-original="yes"><p>Original content</p></section>'
  const pageId=randomUUID()
  const imagePageId=randomUUID()
  for(const page of [{pageId,slug:'original',body:{html:raw}},{pageId:imagePageId,slug:'picture',body:{html:'<link rel="stylesheet" href="/assets/css/a.css"><img alt="Image" src="/assets/images/a.svg" srcset="/assets/images/a.svg 1x, /assets/images/a.svg 2x"><div style="background-image:url(/assets/images/a.svg)">Image</div>'}}]) {
    await fs.writeFile(path.join(root,'source/pages',`${page.pageId}.json`),JSON.stringify({...page,title:'Original',locale:'en',status:'published',seo:{title:'Original',description:'Original'}}))
  }
  git(['add','-A']);git(['-c','user.name=OLPS','-c','user.email=olps@localhost','commit','-m','Legacy website'])
  const options={siteId:site.siteId,siteName:'Converted website',publicApiBaseUrl:'https://olps.example',userId,credentials:{database,draftId:site.draftId}}
  const converted=await convertLegacyContent(root,options)
  expect(converted.convertedPageCount).toBe(2)
  expect(git(['rev-list','--count','HEAD'])).toBe('2')
  const model=(await loadWorkspace(root)).model
  const page=model.pages.find(page=>page.meta.pageId===pageId)!
  expect(page.locales.en!.blocks).toHaveLength(1)
  expect(page.locales.en!.blocks[0]!.props.html).toBe(raw)
  const imagePage=model.pages.find(page=>page.meta.pageId===imagePageId)!
  expect(imagePage.locales.en!.blocks[0]!.props.html).toContain('/assets/uploads/legacy/images/a.svg')
  expect(model.media).toHaveLength(2)
  expect(model.pages.filter(page=>page.meta.role)).toHaveLength(8)
  const encrypted=(await database.query('SELECT ciphertext FROM plugin_secrets WHERE draft_id=$1',[site.draftId])).rows[0].ciphertext
  expect(encrypted).not.toContain(secret)
  expect(JSON.parse(decryptCredential(encrypted,`${site.siteId}/google-maps`))).toEqual({apiKey:secret})
  expect(await fs.readFile(path.join(root,'source/plugins.json'),'utf8')).not.toContain(secret)
  await verifySite(root)
  execFileSync('node',['tools/site-verify.mjs'],{cwd:root})
  expect(await convertLegacyContent(root,options)).toEqual(converted)
  const journal=path.join(root,'.olps-cache/content-conversion-recovery.json')
  await fs.writeFile(journal,JSON.stringify({siteId:site.siteId,draftId:site.draftId,scope:`${site.siteId}/google-maps`,ciphertext:encrypted}))
  await database.query('DELETE FROM plugin_secrets WHERE draft_id=$1',[site.draftId])
  await expect(convertLegacyContent(root,{...options,userId:randomUUID()})).rejects.toThrow('FORBIDDEN')
  expect((await database.query('SELECT * FROM plugin_secrets WHERE draft_id=$1',[site.draftId])).rowCount).toBe(0)
  expect(await convertLegacyContent(root,options)).toEqual(converted)
  expect((await database.query('SELECT ciphertext FROM plugin_secrets WHERE draft_id=$1',[site.draftId])).rows[0].ciphertext).toBe(encrypted)
  expect(await fs.stat(journal).catch(error=>{if(error.code==='ENOENT')return null;throw error})).toBeNull()
  const legacyJournal=path.join(root,'.olps-cache/legacy-credentials.json')
  await fs.writeFile(legacyJournal,JSON.stringify({draftId:site.draftId,scope:`legacy/${site.draftId}`,ciphertext:encryptCredential(JSON.stringify({mapsApiKey:secret}),`legacy/${site.draftId}`)}),{mode:0o600})
  await database.query('DELETE FROM plugin_secrets WHERE draft_id=$1',[site.draftId])
  expect(await convertLegacyContent(root,options)).toEqual(converted)
  const restored=(await database.query('SELECT ciphertext FROM plugin_secrets WHERE draft_id=$1',[site.draftId])).rows[0].ciphertext
  expect(JSON.parse(decryptCredential(restored,`${site.siteId}/google-maps`))).toEqual({apiKey:secret})
  expect(await fs.stat(legacyJournal).catch(error=>{if(error.code==='ENOENT')return null;throw error})).toBeNull()
  expect(git(['status','--porcelain'])).toBe('')
},120000)

it('转换拒绝目录中的符号链接',async()=>{
  const parent=path.resolve('../../.intermediate/content-conversion-tests')
  await fs.mkdir(parent,{recursive:true})
  root=await fs.mkdtemp(path.join(parent,'symlink-'))
  await fs.symlink(parent,path.join(root,'external'))
  await expect(convertLegacyContent(root,{siteId:randomUUID(),siteName:'Site',publicApiBaseUrl:'https://olps.example',userId:randomUUID()})).rejects.toThrow('符号链接')
})

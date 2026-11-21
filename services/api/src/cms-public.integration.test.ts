import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { expect,it } from 'vitest'
import { loadWorkspace } from '@olps/site-builder'
import { migrateWithClient } from './db-schema.js'
import { migrateCmsSchema } from './cms-schema.js'
import { createCmsSite,initializeCmsSite } from './cms-sites.js'
import { createInquiry,setInquiryStatus,recordPublishedContentSnapshot,cmsSiteReport,createPublicEvent,readPublishedContentSnapshot } from './cms-public.js'

it('真实网站快照中的询盘幂等、状态、预览隔离、报告和限流',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_')) throw new Error('只允许测试数据库')
  const schema=`public_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url})
  await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const root=path.resolve('../../.intermediate/cms-public-tests',schema)
  const client=await database.connect()
  try{
    await migrateWithClient(client);await migrateCmsSchema(client)
    const userId=randomUUID()
    await client.query("INSERT INTO users VALUES($1,$1,'password','Owner',NOW(),NOW())",[userId])
    const site=await createCmsSite(userId,'Public test',database,root)
    expect(await initializeCmsSite(userId,site.siteId,database,root)).toEqual({initStatus:'ready'})
    const sandboxId=(await client.query('SELECT sandbox_id FROM site_drafts WHERE draft_id=$1',[site.draftId])).rows[0].sandbox_id
    const workspace=path.join(root,sandboxId)
    await fs.cp(path.resolve('../../packages/render/test-fixtures/sites/full-site'),workspace,{recursive:true})
    const model=(await loadWorkspace(workspace)).model
    execFileSync('git',['add','-A'],{cwd:workspace})
    execFileSync('git',['-c','user.name=OLPS','-c','user.email=olps@localhost','commit','-m','准备完整内容检查'],{cwd:workspace})
    const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:workspace,encoding:'utf8'}).trim()
    await recordPublishedContentSnapshot(site.siteId,commit,model,database)
    await client.query("UPDATE sites SET status='published',published_commit_id=$1 WHERE site_id=$2",[commit,site.siteId])
    const contact=model.pages.find(page=>page.meta.role==='contact')!
    const form=contact.locales.en!.blocks.find(block=>block.type==='plugin/inquiry-form/form')!
    const request={target:{ref:'page' as const,id:contact.meta.pageId},locale:'en',formId:form.id,fields:{name:'Visitor',email:'visitor@example.com',message:'Please provide a quotation.'},privacyConsent:true as const,attribution:{utm_source:'newsletter'},eventId:randomUUID()}
    const input={siteId:site.siteId,source:'public' as const,request,clientKey:'visitor-a'}
    const constrained=new pg.Pool({...database.options,max:1,connectionTimeoutMillis:2000})
    const [first,second]=await Promise.all([createInquiry(input,constrained,root),createInquiry(input,constrained,root)]).finally(()=>constrained.end())
    expect(first).toEqual(second)
    expect((await client.query('SELECT * FROM inquiries WHERE site_id=$1',[site.siteId])).rowCount).toBe(1)
    await setInquiryStatus(userId,site.siteId,first.inquiryId,'qualified',database)
    await setInquiryStatus(userId,site.siteId,first.inquiryId,'qualified',database)
    expect((await client.query("SELECT * FROM cms_outbound_tasks WHERE kind='qualified_conversion'")).rowCount).toBe(1)
    await setInquiryStatus(userId,site.siteId,first.inquiryId,'handled',database)
    await expect(setInquiryStatus(userId,site.siteId,first.inquiryId,'new',database)).rejects.toThrow('INQUIRY_STATUS_TRANSITION_INVALID')
    const tasks=(await client.query('SELECT count(*) FROM cms_outbound_tasks')).rows
    const preview=await createInquiry({...input,source:'preview',draftId:site.draftId,request:{...request,eventId:randomUUID()}},database,root)
    await setInquiryStatus(userId,site.siteId,preview.inquiryId,'qualified',database)
    expect((await client.query('SELECT count(*) FROM cms_outbound_tasks')).rows).toEqual(tasks)
    const previewRows=await client.query("SELECT * FROM inquiries WHERE source='preview'")
    expect(previewRows.rows[0].draft_id).toBe(site.draftId)
    await expect(createInquiry({...input,request:{...request,privacyConsent:false,eventId:randomUUID()}},database,root)).rejects.toThrow()
    await expect(createInquiry({...input,request:{...request,formId:'unknown',eventId:randomUUID()}},database,root)).rejects.toThrow('INQUIRY_FORM_INVALID')
    await expect(createInquiry({...input,request:{...request,fields:{...request.fields,email:'bad'},eventId:randomUUID()}},database,root)).rejects.toThrow()
    for(let index=0;index<20;index++) await createInquiry({...input,clientKey:'rate-limit',request:{...request,eventId:randomUUID()}},database,root)
    await expect(createInquiry({...input,clientKey:'rate-limit',request:{...request,eventId:randomUUID()}},database,root)).rejects.toThrow('INQUIRY_RATE_LIMIT')
    const event={eventId:randomUUID(),name:'page_view',target:request.target,locale:'en',payload:{}}
    await createPublicEvent(site.siteId,event,database);await createPublicEvent(site.siteId,event,database)
    expect((await client.query('SELECT * FROM cms_public_events WHERE event_id=$1',[event.eventId])).rowCount).toBe(1)
    const report=await cmsSiteReport(userId,site.siteId,database,site.draftId,root)
    expect(new Set(report.map(row=>row.target.ref))).toEqual(new Set(['page','collection','group','item']))
    expect(new Set(report.map(row=>row.locale))).toEqual(new Set(['en','zh-CN']))
    await expect(cmsSiteReport(randomUUID(),site.siteId,database)).rejects.toThrow('FORBIDDEN')
    const changed=structuredClone(model);changed.settings.siteName='Different'
    await expect(recordPublishedContentSnapshot(site.siteId,commit,changed,database)).rejects.toThrow('PUBLISHED_SNAPSHOT_IMMUTABLE')
    expect((await readPublishedContentSnapshot(site.siteId,database)).settings.siteName).toBe(model.settings.siteName)
  }finally{
    client.release();await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})
  }
},120000)

import { randomUUID,createHash } from 'node:crypto'
import path from 'node:path'
import type pg from 'pg'
import { z } from 'zod'
import type { BlockNode,ContentRef } from '@olps/domain'
import type { SiteModel } from '@olps/render'
import { resolveContentRef } from '@olps/render'
import { loadWorkspace } from '@olps/site-builder'
import { pool } from './db.js'
import { appConfig } from './config.js'
import { isDeepStrictEqual } from 'node:util'
import { runCmsSiteReport } from './cms-reports.js'

const requestSchema=z.object({target:z.object({ref:z.enum(['page','collection','group','item']),id:z.string().uuid()}).strict(),locale:z.string().min(1).max(50),formId:z.string().min(1).max(200),fields:z.object({name:z.string().trim().min(1).max(200),email:z.email().max(320),message:z.string().trim().min(1).max(10000)}).strict(),privacyConsent:z.literal(true),consent:z.object({analytics:z.boolean(),advertising:z.boolean()}).strict().default({analytics:false,advertising:false}),attribution:z.record(z.string(),z.unknown()).default({}),eventId:z.string().uuid()}).strict()
export type CmsInquiryRequest=z.input<typeof requestSchema>
export type InquiryInput={siteId:string;source:'public'|'preview';draftId?:string;request:unknown;clientKey:string}

export async function createCmsPublicSchema(client:pg.PoolClient):Promise<void>{
  await client.query("ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS cms_id TEXT, ADD COLUMN IF NOT EXISTS cms_event_id TEXT, ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'public', ADD COLUMN IF NOT EXISTS locale TEXT, ADD COLUMN IF NOT EXISTS target JSONB, ADD COLUMN IF NOT EXISTS form_id TEXT, ADD COLUMN IF NOT EXISTS redirect_url TEXT")
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_inquiries_cms_id ON inquiries(cms_id) WHERE cms_id IS NOT NULL')
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_inquiries_cms_event ON inquiries(site_id,source,COALESCE(draft_id,''),cms_event_id) WHERE cms_event_id IS NOT NULL")
  await client.query("CREATE TABLE IF NOT EXISTS cms_public_snapshots(site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,commit_id TEXT NOT NULL,model JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(site_id,commit_id))")
  await client.query("CREATE TABLE IF NOT EXISTS cms_outbound_tasks(task_id TEXT PRIMARY KEY,inquiry_id BIGINT NOT NULL REFERENCES inquiries(inquiry_id) ON DELETE CASCADE,site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,kind TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(inquiry_id,kind))")
  await client.query("CREATE TABLE IF NOT EXISTS cms_public_events(site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,event_id TEXT NOT NULL,name TEXT NOT NULL,target JSONB NOT NULL,locale TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(site_id,event_id))")
  await client.query("CREATE TABLE IF NOT EXISTS cms_public_rate_limits(site_id TEXT NOT NULL,source TEXT NOT NULL,client_hash TEXT NOT NULL,window_start TIMESTAMPTZ NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(site_id,source,client_hash,window_start))")
}

export async function recordPublishedContentSnapshot(siteId:string,publishedCommitId:string,model:SiteModel,database:pg.Pool=pool):Promise<void>{
  const client=await database.connect()
  try{
    await client.query('BEGIN');await createCmsPublicSchema(client)
    const existing=await client.query('SELECT model FROM cms_public_snapshots WHERE site_id=$1 AND commit_id=$2',[siteId,publishedCommitId])
    if(existing.rowCount && !isDeepStrictEqual(existing.rows[0].model,JSON.parse(JSON.stringify(model)))) throw new Error('PUBLISHED_SNAPSHOT_IMMUTABLE')
    await client.query('INSERT INTO cms_public_snapshots(site_id,commit_id,model) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[siteId,publishedCommitId,model])
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

export async function readPublishedContentSnapshot(siteId:string,database:Pick<pg.Pool,'query'>=pool):Promise<SiteModel>{
  const result=await database.query("SELECT p.model FROM sites s JOIN cms_public_snapshots p ON p.site_id=s.site_id AND p.commit_id=s.published_commit_id WHERE s.site_id=$1 AND s.status='published'",[siteId])
  if(!result.rowCount) throw new Error('PUBLISHED_SNAPSHOT_UNAVAILABLE')
  return result.rows[0].model as SiteModel
}

type ContentEntry={target:ContentRef;locale:string;title:string;status:string;blocks:BlockNode[];seo:{title:string;description:string};slug:string}
function contentEntries(model:SiteModel):ContentEntry[]{
  const entries:ContentEntry[]=[]
  for(const page of model.pages) for(const [locale,file] of Object.entries(page.locales)) entries.push({target:{ref:'page',id:page.meta.pageId},locale,title:file.title,status:page.meta.status,blocks:file.blocks,seo:file.seo,slug:file.slug})
  for(const collection of model.collections){
    for(const [locale,file] of Object.entries(collection.indexLocales)) entries.push({target:{ref:'collection',id:collection.definition.collectionId},locale,title:file.title,status:collection.definition.status,blocks:file.blocks,seo:file.seo,slug:collection.definition.prefix})
    for(const group of collection.groups) for(const [locale,file] of Object.entries(group.locales)) entries.push({target:{ref:'group',id:group.meta.groupId},locale,title:file.title,status:collection.definition.status==='published'?group.meta.status:'draft',blocks:file.blocks,seo:file.seo,slug:file.slug})
    for(const item of collection.items) for(const [locale,file] of Object.entries(item.locales)) entries.push({target:{ref:'item',id:item.meta.itemId},locale,title:file.title,status:collection.definition.status==='published'?item.meta.status:'draft',blocks:file.blocks,seo:file.seo,slug:file.slug})
  }
  return entries
}
function findForm(blocks:BlockNode[],formId:string):boolean{
  return blocks.some(block=>(block.id===formId && block.type==='plugin/inquiry-form/form') || findForm(block.children,formId))
}
async function modelFor(input:Pick<InquiryInput,'source'|'siteId'|'draftId'>,database:Pick<pg.Pool,'query'>,sandboxRoot:string):Promise<SiteModel>{
  if(input.source==='public') return readPublishedContentSnapshot(input.siteId,database)
  if(!input.draftId) throw new Error('PREVIEW_DRAFT_REQUIRED')
  const draft=await database.query('SELECT sandbox_id FROM site_drafts WHERE draft_id=$1 AND site_id=$2',[input.draftId,input.siteId])
  if(!draft.rowCount || !/^[a-f\d-]{36}$/i.test(draft.rows[0].sandbox_id)) throw new Error('NOT_FOUND')
  return (await loadWorkspace(path.join(sandboxRoot,draft.rows[0].sandbox_id))).model
}
function validateTarget(model:SiteModel,target:ContentRef,locale:string,source:'public'|'preview'):ContentEntry{
  const entry=contentEntries(model).find(item=>item.target.ref===target.ref && item.target.id===target.id && item.locale===locale)
  if(!entry || (source==='public' && entry.status!=='published')) throw new Error('INQUIRY_TARGET_INVALID')
  return entry
}
function missingConfiguration(kind:string):string|null{
  const keys=kind==='email'?['SMTP_HOST','SMTP_FROM']:[]
  const missing=keys.filter(key=>!process.env[key]?.trim())
  return missing.length?`缺少配置：${missing.join(', ')}`:null
}
async function addOutboundTask(client:pg.PoolClient,inquiryId:string,siteId:string,kind:string):Promise<void>{
  const missing=missingConfiguration(kind)
  await client.query('INSERT INTO cms_outbound_tasks(task_id,inquiry_id,site_id,kind,status,last_error) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(inquiry_id,kind) DO NOTHING',[randomUUID(),inquiryId,siteId,kind,missing?'blocked':'pending',missing])
}

export async function createInquiry(input:InquiryInput,database:pg.Pool=pool,sandboxRoot:string=appConfig.sandboxRoot):Promise<{inquiryId:string;redirectUrl:string}>{
  const request=requestSchema.parse(input.request)
  if(Buffer.byteLength(JSON.stringify(request.attribution))>20000) throw new Error('INQUIRY_ATTRIBUTION_TOO_LARGE')
  const client=await database.connect()
  try{
    await client.query('BEGIN');await createCmsPublicSchema(client)
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${input.siteId}:${input.source}:${input.draftId??''}:${request.eventId}`])
    const existing=await client.query("SELECT cms_id,redirect_url FROM inquiries WHERE site_id=$1 AND source=$2 AND COALESCE(draft_id,'')=$3 AND cms_event_id=$4",[input.siteId,input.source,input.draftId??'',request.eventId])
    if(existing.rowCount){await client.query('COMMIT');return{inquiryId:existing.rows[0].cms_id,redirectUrl:existing.rows[0].redirect_url}}
    const model=await modelFor(input,client,sandboxRoot)
    const entry=validateTarget(model,request.target,request.locale,input.source)
    if(!model.plugins.plugins['inquiry-form']?.enabled || !findForm(entry.blocks,request.formId)) throw new Error('INQUIRY_FORM_INVALID')
    const thankYou=model.pages.find(page=>page.meta.role==='thank-you')
    if(!thankYou?.locales[request.locale]) throw new Error('INQUIRY_THANK_YOU_MISSING')
    const rate=await client.query("INSERT INTO cms_public_rate_limits(site_id,source,client_hash,window_start,count) VALUES($1,$2,$3,date_trunc('minute',NOW()),1) ON CONFLICT(site_id,source,client_hash,window_start) DO UPDATE SET count=cms_public_rate_limits.count+1 RETURNING count",[input.siteId,input.source,createHash('sha256').update(input.clientKey).digest('hex')])
    if(rate.rows[0].count>20) throw new Error('INQUIRY_RATE_LIMIT')
    const inquiryId=randomUUID()
    const mode=input.source==='public'?'publish':'preview'
    const targetUrl=resolveContentRef(model,request.target,{locale:request.locale,fromUrl:`/${request.locale}/`,mode})
    const fromUrl=new URL(targetUrl,`https://relative.invalid/${request.locale}/`).pathname
    const redirectUrl=resolveContentRef(model,{ref:'page',id:thankYou.meta.pageId},{locale:request.locale,fromUrl,mode})
    const inserted=await client.query("INSERT INTO inquiries(cms_id,cms_event_id,source,site_id,draft_id,page_id,payload,status,locale,target,form_id,redirect_url) VALUES($1,$2,$3,$4,$5,$6,$7,'new',$8,$9,$10,$11) RETURNING inquiry_id",[inquiryId,request.eventId,input.source,input.siteId,input.draftId??null,request.target.id,{...request,contentTitle:entry.title,notificationEmail:model.plugins.plugins['inquiry-form']?.settings.notifyEmail??null},request.locale,request.target,request.formId,redirectUrl])
    if(input.source==='public'){
      await addOutboundTask(client,inserted.rows[0].inquiry_id,input.siteId,'email')
      await addOutboundTask(client,inserted.rows[0].inquiry_id,input.siteId,'submit_conversion')
      await client.query("INSERT INTO cms_public_events(site_id,event_id,name,target,locale,payload) VALUES($1,$2,'inquiry_submit',$3,$4,$5) ON CONFLICT DO NOTHING",[input.siteId,request.eventId,request.target,request.locale,{attribution:request.attribution}])
    }
    await client.query('COMMIT')
    return{inquiryId,redirectUrl}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

export async function setInquiryStatus(userId:string,siteId:string,inquiryId:string,status:'new'|'qualified'|'invalid'|'handled',database:pg.Pool=pool):Promise<void>{
  const client=await database.connect()
  try{
    await client.query('BEGIN')
    const result=await client.query('SELECT i.* FROM inquiries i JOIN site_owners o ON o.site_id=i.site_id AND o.user_id=$1 WHERE i.site_id=$2 AND i.cms_id=$3 FOR UPDATE OF i',[userId,siteId,inquiryId])
    if(!result.rowCount) throw new Error('NOT_FOUND')
    const inquiry=result.rows[0]
    const allowed:Record<string,string[]>={new:['qualified','invalid'],qualified:['handled'],invalid:['handled'],handled:[]}
    if(status!==inquiry.status && !allowed[inquiry.status]?.includes(status)) throw new Error('INQUIRY_STATUS_TRANSITION_INVALID')
    if(status==='qualified' && inquiry.source==='public') await addOutboundTask(client,inquiry.inquiry_id,siteId,'qualified_conversion')
    await client.query('UPDATE inquiries SET status=$1,updated_at=NOW() WHERE inquiry_id=$2',[status,inquiry.inquiry_id])
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

export async function createPublicEvent(siteId:string,input:unknown,database:pg.Pool=pool,clientKey:string='unknown'):Promise<void>{
  const event=z.object({eventId:z.string().uuid(),name:z.enum(['page_view','form_start','inquiry_submit','phone_click','email_click','whatsapp_click','download_click','outbound_click','scroll_depth']),target:z.object({ref:z.enum(['page','collection','group','item']),id:z.string().uuid()}),locale:z.string().min(1),payload:z.record(z.string(),z.unknown()).default({})}).strict().parse(input)
  if(Buffer.byteLength(JSON.stringify(event))>20000) throw new Error('EVENT_TOO_LARGE')
  const model=await readPublishedContentSnapshot(siteId,database)
  validateTarget(model,event.target,event.locale,'public')
  const client=await database.connect()
  try{
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${siteId}:event:${event.eventId}`])
    if(!(await client.query('SELECT 1 FROM cms_public_events WHERE site_id=$1 AND event_id=$2',[siteId,event.eventId])).rowCount){
      const rate=await client.query("INSERT INTO cms_public_rate_limits(site_id,source,client_hash,window_start,count) VALUES($1,'event',$2,date_trunc('minute',NOW()),1) ON CONFLICT(site_id,source,client_hash,window_start) DO UPDATE SET count=cms_public_rate_limits.count+1 RETURNING count",[siteId,createHash('sha256').update(clientKey).digest('hex')])
      if(rate.rows[0].count>120) throw new Error('INQUIRY_RATE_LIMIT')
      await client.query('INSERT INTO cms_public_events(site_id,event_id,name,target,locale,payload) VALUES($1,$2,$3,$4,$5,$6)',[siteId,event.eventId,event.name,event.target,event.locale,event.payload])
    }
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

export async function cmsSiteReport(userId:string,siteId:string,database:pg.Pool=pool,draftId?:string,sandboxRoot:string=appConfig.sandboxRoot){
  return (await runCmsSiteReport(userId,siteId,database,draftId,sandboxRoot)).content
}

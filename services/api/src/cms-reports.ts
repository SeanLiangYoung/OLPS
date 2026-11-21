import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { parse,type DefaultTreeAdapterMap } from 'parse5'
import type { ContentRef } from '@olps/domain'
import { inspectSeo,renderTarget,type RenderTargetRef,type SiteModel } from '@olps/render'
import { collectPublicHtmlRoutes,loadWorkspace,runBuildChecks } from '@olps/site-builder'
import { pool } from './db.js'
import { appConfig } from './config.js'
import { withDraftLock } from './draft-lock.js'

export type ReportIssue={code:'seo'|'internal_link'|'build';message:string;target?:ContentRef;locale?:string;url?:string}
export type ContentReport={target:ContentRef;locale:string;title:string;url:string;seoTitle:boolean;seoDescription:boolean;inquiries:number;issues:ReportIssue[]}
export type SiteReport={reportId:string;draftId:string;createdAt:string;summary:{total:number;issues:number;affected:number};content:ContentReport[];issues:ReportIssue[]}
type Entry={target:ContentRef;renderTarget:RenderTargetRef;locale:string;title:string;seo:{title:string;description:string}}

function entries(model:SiteModel):Entry[]{
  const result:Entry[]=[]
  for(const page of model.pages)for(const [locale,file]of Object.entries(page.locales))result.push({target:{ref:'page',id:page.meta.pageId},renderTarget:{kind:'page',pageId:page.meta.pageId},locale,title:file.title,seo:file.seo})
  for(const collection of model.collections){
    const collectionId=collection.definition.collectionId
    for(const [locale,file]of Object.entries(collection.indexLocales))result.push({target:{ref:'collection',id:collectionId},renderTarget:{kind:'collection',collectionId},locale,title:file.title,seo:file.seo})
    for(const group of collection.groups)for(const [locale,file]of Object.entries(group.locales))result.push({target:{ref:'group',id:group.meta.groupId},renderTarget:{kind:'group',collectionId,groupId:group.meta.groupId},locale,title:file.title,seo:file.seo})
    for(const item of collection.items)for(const [locale,file]of Object.entries(item.locales))result.push({target:{ref:'item',id:item.meta.itemId},renderTarget:{kind:'item',collectionId,itemId:item.meta.itemId},locale,title:file.title,seo:file.seo})
  }
  return result
}

async function authorize(userId:string,siteId:string,database:pg.Pool):Promise<void>{
  if(!(await database.query('SELECT 1 FROM site_owners WHERE site_id=$1 AND user_id=$2',[siteId,userId])).rowCount)throw new Error('FORBIDDEN')
}
async function ensureSchema(database:pg.Pool):Promise<void>{
  const client=await database.connect()
  try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('cms-report-schema'))");await client.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_kind TEXT,ADD COLUMN IF NOT EXISTS summary JSONB,ADD COLUMN IF NOT EXISTS issues JSONB");await client.query('COMMIT')}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
function htmlReferences(html:string):{hrefs:string[];ids:Set<string>}{
  const hrefs:string[]=[];const ids=new Set<string>()
  const walk=(node:DefaultTreeAdapterMap['node']):void=>{
    if('attrs'in node){
      const id=node.attrs.find(attribute=>attribute.name==='id')?.value;if(id)ids.add(id)
      if(node.tagName==='a'||node.tagName==='area'||(node.tagName==='link'&&node.attrs.some(attribute=>attribute.name==='rel'&&['canonical','alternate'].includes(attribute.value)))){
        const href=node.attrs.find(attribute=>attribute.name==='href')?.value;if(href)hrefs.push(href)
      }
    }
    if('childNodes'in node)node.childNodes.forEach(walk)
  };walk(parse(html));return {hrefs,ids}
}
function refKey(target:ContentRef,locale:string):string{return `${target.ref}:${target.id}:${locale}`}

export async function runCmsSiteReport(userId:string,siteId:string,database:pg.Pool=pool,draftId?:string,sandboxRoot:string=appConfig.sandboxRoot):Promise<SiteReport>{
  await authorize(userId,siteId,database)
  const draft=await database.query("SELECT d.* FROM site_drafts d JOIN draft_owners o USING(draft_id) WHERE d.site_id=$1 AND o.user_id=$2 AND ($3::text IS NULL OR d.draft_id=$3) AND d.init_status='ready' ORDER BY d.updated_at DESC LIMIT 1",[siteId,userId,draftId??null])
  if(!draft.rowCount)throw new Error('FORBIDDEN')
  const row=draft.rows[0]
  if(!/^[a-f\d-]{36}$/i.test(row.sandbox_id))throw new Error('INVALID_SANDBOX_ID')
  return withDraftLock(row.draft_id,async()=>{
    await authorize(userId,siteId,database)
    if(!(await database.query('SELECT 1 FROM draft_owners WHERE draft_id=$1 AND user_id=$2',[row.draft_id,userId])).rowCount)throw new Error('FORBIDDEN')
    const loaded=await loadWorkspace(path.join(sandboxRoot,row.sandbox_id))
    const targets=entries(loaded.model);const issues:ReportIssue[]=[]
    try{await runBuildChecks(loaded,'preview')}catch{issues.push({code:'build',message:'网站构建检查未通过，请检查必备页面、主题、区块引用和固定文字。'})}
    const routes=collectPublicHtmlRoutes(loaded.model,'preview')
    for(const page of loaded.model.pages.filter(page=>page.meta.role==='not-found'))for(const locale of Object.keys(page.locales))routes.push({url:`/${locale}/404.html`,relativePath:`${locale}/404.html`,target:{kind:'page',pageId:page.meta.pageId},locale,pageNumber:1})
    const routeSet=new Set(routes.map(route=>route.url))
    const counts=(await database.query("SELECT target,locale,count(*)::int AS inquiries FROM inquiries WHERE site_id=$1 AND source='public' GROUP BY target,locale",[siteId])).rows
    const documents=new Map<string,ReturnType<typeof htmlReferences>>()
    const content:ContentReport[]=[]
    for(const entry of targets){
      const route=routes.find(route=>route.locale===entry.locale&&route.pageNumber===1&&JSON.stringify(route.target)===JSON.stringify(entry.renderTarget))
      const item:ContentReport={target:entry.target,locale:entry.locale,title:entry.title,url:route?.url??'',seoTitle:!!entry.seo.title.trim(),seoDescription:!!entry.seo.description.trim(),inquiries:counts.find(count=>count.target?.ref===entry.target.ref&&count.target?.id===entry.target.id&&count.locale===entry.locale)?.inquiries??0,issues:[]}
      try{
        const html=await renderTarget(loaded.model,entry.renderTarget,entry.locale,{reader:loaded.reader,mode:'preview'})
        const others=targets.filter(other=>other.locale===entry.locale&&refKey(other.target,other.locale)!==refKey(entry.target,entry.locale)).map(other=>other.seo.title)
        item.issues=inspectSeo(html,entry.seo.title,entry.seo.description,others).map(message=>({code:'seo',message,target:entry.target,locale:entry.locale}))
        documents.set(item.url,htmlReferences(html))
      }catch{item.issues.push({code:'build',message:'这份内容无法生成，请检查主题、区块字段和引用的内容。',target:entry.target,locale:entry.locale})}
      content.push(item)
    }
    const deployment=new URL(loaded.model.settings.siteUrl.endsWith('/')?loaded.model.settings.siteUrl:loaded.model.settings.siteUrl+'/')
    const mediaPaths=new Set(loaded.model.media.map(media=>'/'+media.path))
    const redirects=new Set(loaded.model.redirects.redirects.map(redirect=>redirect.from))
    for(const item of content){
      for(const href of documents.get(item.url)?.hrefs??[]){
        let destination:URL
        try{destination=new URL(href,new URL(item.url.slice(1),deployment))}catch{item.issues.push({code:'internal_link',message:'部分链接地址无效，请重新选择链接目标。',target:item.target,locale:item.locale,url:href});continue}
        if(!['http:','https:'].includes(destination.protocol)||destination.origin!==deployment.origin)continue
        const pathname=destination.pathname.startsWith(deployment.pathname)?'/'+destination.pathname.slice(deployment.pathname.length):destination.pathname
        const target=documents.get(pathname)
        let missing=!routeSet.has(pathname)&&!mediaPaths.has(pathname)&&!redirects.has(pathname)
        if(!missing&&destination.hash&&target){let id:string;try{id=decodeURIComponent(destination.hash.slice(1))}catch{id=''};missing=!target.ids.has(id)}
        if(missing&&!item.issues.some(issue=>issue.code==='internal_link'&&issue.url===href))item.issues.push({code:'internal_link',message:'部分站内链接无法打开，请重新选择目标内容或标题位置。',target:item.target,locale:item.locale,url:href})
      }
      issues.push(...item.issues)
    }
    const report:SiteReport={reportId:randomUUID(),draftId:row.draft_id,createdAt:new Date().toISOString(),summary:{total:content.length,issues:issues.length,affected:content.filter(item=>item.issues.length).length},content,issues}
    await ensureSchema(database)
    const score=content.length?Math.round(100*(content.length-report.summary.affected)/content.length):100
    await database.query("INSERT INTO reports(report_id,user_id,site_id,draft_id,page_id,score,checklist,created_at,report_kind,summary,issues) VALUES($1,$2,$3,$4,'',$5,$6,$7,'site',$8,$9)",[report.reportId,userId,siteId,row.draft_id,score,JSON.stringify(content),report.createdAt,report.summary,JSON.stringify(issues)])
    return report
  })
}

export async function readCmsReportHistory(userId:string,siteId:string,database:pg.Pool=pool){
  await authorize(userId,siteId,database);await ensureSchema(database)
  const rows=(await database.query('SELECT report_id,created_at,score,summary,report_kind FROM reports WHERE site_id=$1 ORDER BY created_at DESC,report_id',[siteId])).rows
  return rows.map(row=>({reportId:row.report_id,createdAt:new Date(row.created_at).toISOString(),score:row.score,summary:row.summary,legacy:row.report_kind!=='site'}))
}
export async function readCmsReport(userId:string,siteId:string,reportId:string,database:pg.Pool=pool){
  await authorize(userId,siteId,database);await ensureSchema(database)
  const row=(await database.query('SELECT * FROM reports WHERE site_id=$1 AND report_id=$2',[siteId,reportId])).rows[0]
  if(!row)throw new Error('NOT_FOUND')
  return {reportId:row.report_id,draftId:row.draft_id,createdAt:new Date(row.created_at).toISOString(),summary:row.summary,issues:row.issues??[],content:row.report_kind==='site'?row.checklist:[],legacy:row.report_kind!=='site',checklist:row.report_kind==='site'?undefined:row.checklist,score:row.score}
}

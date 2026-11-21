import { randomUUID } from 'node:crypto'
import { expect,it } from 'vitest'
import { withCmsContentSite } from './test-support/cms-content-fixture.js'
import { createIntegrationSchema } from './integration-schema.js'
import { createCmsPublicSchema } from './cms-public.js'
import { readCmsMarketingMetrics,readCmsOverview } from './cms-marketing-metrics.js'
import { saveContentBatch } from './content-sandbox.js'

it('真实数据库读取平台原始指标与来源询盘，缺数据保持未同步并区分币种',()=>withCmsContentSite(async(context,client)=>{
  await createIntegrationSchema(client);await createCmsPublicSchema(client)
  const siteId=(await client.query('SELECT site_id FROM site_drafts WHERE draft_id=$1',[context.draftId])).rows[0].site_id
  const now=new Date('2026-11-21T12:00:00Z')
  const empty=await readCmsMarketingMetrics('owner',siteId,context.database,context.draftId,now)
  expect(empty.platforms.every(platform=>platform.status==='not_synced')).toBe(true)
  expect(empty.platforms.every(platform=>Object.values(platform.metrics).every(metric=>metric.value===null))).toBe(true)
  await client.query("UPDATE sites SET status='published' WHERE site_id=$1",[siteId])
  const scope=`site:${siteId}`
  const put=async(connector:string,date:string,data:unknown)=>client.query('INSERT INTO marketing_metrics(scope_key,site_id,connector,date,data) VALUES($1,$2,$3,$4,$5)',[scope,siteId,connector,date,data])
  await put('ga4','2026-11-20',{totals:{metricHeaders:[{name:'sessions'},{name:'screenPageViews'},{name:'activeUsers'},{name:'keyEvents'}],rows:[{metricValues:[{value:'12'},{value:'25'},{value:'9'},{value:'3'}]}]},sources:{rows:[]}})
  await put('googleAds','2026-11-20',{rows:[{customer:{id:'account-a',currency_code:'USD'},metrics:{impressions:'1000',clicks:'20',cost_micros:'12000000',conversions:'2.5'}}]})
  await put('googleAds','2026-11-19',{rows:[{customer:{currency_code:'EUR'},metrics:{impressions:500,clicks:10,cost_micros:9000000,conversions:1}}]})
  await put('googleAds','2026-11-18',{rows:[{metrics:{impressions:100,clicks:2,cost_micros:4000000,conversions:0}}]})
  await put('meta','2026-11-20',{rows:[{account_id:'meta-a',account_currency:'USD',impressions:'800',clicks:'10',spend:'8.50',actions:[{action_type:'lead',value:'2'},{action_type:'offsite_conversion.fb_pixel_lead',value:'2'}]}]})
  await put('searchConsole','2026-11-20',{rows:[{keys:['2026-11-20'],clicks:4,impressions:60,ctr:4/60,position:5}]})
  const inquiry=async(date:string,attribution:Record<string,string>,source='public',qualified=false)=>{
    const result=await client.query("INSERT INTO inquiries(site_id,draft_id,page_id,cms_id,cms_event_id,payload,status,source,created_at,updated_at) VALUES($1,$2,'11111111-1111-4111-8111-111111111103',$3,$4,$5,$6,$7,$8,$8) RETURNING inquiry_id",[siteId,context.draftId,randomUUID(),randomUUID(),{attribution},qualified?'qualified':'new',source,`${date}T12:00:00Z`])
    return result.rows[0].inquiry_id
  }
  await inquiry('2026-11-20',{gclid:'click-a'},'public',true)
  const handled=await inquiry('2026-11-20',{utm_source:'google',utm_medium:'cpc'})
  await client.query("INSERT INTO cms_outbound_tasks(task_id,inquiry_id,site_id,kind,status) VALUES($1,$2,$3,'qualified_conversion','blocked')",[randomUUID(),handled,siteId])
  await client.query("UPDATE inquiries SET status='handled' WHERE inquiry_id=$1",[handled])
  await inquiry('2026-11-20',{fbclid:'meta-click'})
  await inquiry('2026-11-20',{gclid:'mixed-google',fbclid:'mixed-meta'})
  await inquiry('2026-11-20',{fbp:'browser-only'})
  await inquiry('2026-11-20',{gclid:'preview'},'preview')
  await inquiry('2026-11-19',{gclid:'eur'})
  await inquiry('2026-10-01',{gclid:'old'})
  await client.query("INSERT INTO cms_public_events VALUES($1,$2,'page_view',$3,'en','{}',$4),($1,$5,'page_view',$3,'en','{}',$4)",[siteId,randomUUID(),{ref:'page',id:'11111111-1111-4111-8111-111111111101'},'2026-11-20T12:00:00Z',randomUUID()])
  const result=await readCmsMarketingMetrics('owner',siteId,context.database,context.draftId,now)
  expect(result.inquiries.total).toBe(6);expect(result.inquiries.qualified).toBe(2);expect(result.native.pageViews).toBe(2)
  const ga4=result.platforms.find(platform=>platform.connector==='ga4')!
  expect(ga4.metrics.sessions.value).toBe(12);expect(ga4.metrics.pageViews.value).toBe(25);expect(ga4.metrics.keyEvents.value).toBe(3)
  const ads=result.platforms.find(platform=>platform.connector==='googleAds')!
  expect(ads.metrics.conversions.value).toBe(3.5)
  expect(ads.spend.map(spend=>spend.currency)).toEqual(expect.arrayContaining(['USD','EUR']))
  expect(ads.unknownSpend).toEqual([{date:'2026-11-18',amount:4}])
  const usd=ads.spend.find(spend=>spend.currency==='USD')!
  expect(usd.amount).toBe(12);expect(usd.inquiries).toBe(2);expect(usd.costPerInquiry).toBe(6);expect(usd.costPerQualifiedInquiry).toBe(6)
  const meta=result.platforms.find(platform=>platform.connector==='meta')!
  expect(meta.metrics.platformLeads.value).toBe(2);expect(meta.metrics.websiteLeads.value).toBe(2)
  expect(meta.spend[0].costPerInquiry).toBe(8.5)
  expect(result.inquiries.sources.find(source=>source.source==='ambiguous')!.total).toBe(1)
  await client.query("UPDATE marketing_metrics SET data=$3 WHERE scope_key=$1 AND connector='googleAds' AND date=$2",[scope,'2026-11-20',{rows:[{customer:{currency_code:'USD'},metrics:{impressions:100,clicks:2,cost_micros:12000000,conversions:1}},{customer:{currency_code:'USD'},metrics:{impressions:100,clicks:2,conversions:1}}]}])
  const incomplete=await readCmsMarketingMetrics('owner',siteId,context.database,context.draftId,now)
  expect(incomplete.platforms.find(platform=>platform.connector==='googleAds')!.spend.find(spend=>spend.currency==='USD')!.costPerInquiry).toBeNull()
  await expect(readCmsMarketingMetrics('stranger',siteId,context.database,context.draftId,now)).rejects.toThrow('FORBIDDEN')
}),120000)

it('概况使用真实完整索引计数，不受列表的一百条分页限制',()=>withCmsContentSite(async(context,client)=>{
  await createIntegrationSchema(client);await createCmsPublicSchema(client)
  const now=new Date().toISOString()
  const locale={schemaVersion:1,locale:'en',title:'Count',summary:'',cover:null,seo:{title:'Count',description:'',ogImage:null},blocks:[],sourceHash:null,updatedAt:now}
  await saveContentBatch(context,Array.from({length:102},()=>{const id=randomUUID();return {revision:null,content:{ref:'page' as const,meta:{schemaVersion:1,pageId:id,role:null,template:'page',status:'draft',createdAt:now,updatedAt:now},locale:{...locale,slug:`page-${id}`}}}}))
  await saveContentBatch(context,Array.from({length:102},()=>{const id=randomUUID();return {revision:null,content:{ref:'collection' as const,meta:{schemaVersion:1,collectionId:id,name:'Count',labels:{en:'Count'},prefix:`count-${id}`,status:'draft',levels:[],fields:[],structuredData:null,feed:false,createdAt:now,updatedAt:now},locale}}}))
  const siteId=(await client.query('SELECT site_id FROM site_drafts WHERE draft_id=$1',[context.draftId])).rows[0].site_id
  const result=await readCmsOverview('owner',siteId,context.draftId,'en',context.database)
  expect(result.counts.pages).toBe(110);expect(result.counts.collections).toBe(105)
}),300000)

import type pg from 'pg'
import { pool } from './db.js'

type Connector='ga4'|'googleAds'|'meta'|'searchConsole'
type Source='googleAds'|'meta'|'ambiguous'|'other'
type Metric={value:number|null;days:number}
type Money={date:string;amount:number|null;currency:string|null}
type Daily={date:string;metrics:Record<string,number|null>;money:Money[]}
type Inquiry={date:string;source:Source;qualified:boolean}
export type Spend={currency:string;amount:number;days:number;inquiries:number;qualified:number;costPerInquiry:number|null;costPerQualifiedInquiry:number|null;costUnavailableReason:string|null}
export type MarketingPlatform={connector:Connector;status:'not_synced'|'partial'|'synced';availableDays:number;expectedDays:number;lastSyncedAt:string|null;connectionStatus:string;metrics:Record<string,Metric>;spend:Spend[];unknownSpend:Array<{date:string;amount:number|null}>;sourceInquiries:number;qualifiedSourceInquiries:number}
const metricNames:Record<Connector,string[]>={ga4:['activeUsers','sessions','pageViews','keyEvents'],googleAds:['impressions','clicks','conversions'],meta:['impressions','clicks','platformLeads','websiteLeads','onsiteLeads'],searchConsole:['clicks','impressions']}

function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('MARKETING_DATA_INVALID');return value as Record<string,unknown>}
function rows(value:unknown):Record<string,unknown>[]{if(value===undefined)return [];if(!Array.isArray(value))throw new Error('MARKETING_DATA_INVALID');return value.map(object)}
function number(value:unknown):number|null{
  if(value===null||value===undefined)return null
  if((typeof value!=='number'&&typeof value!=='string')||(typeof value==='string'&&!value.trim()))throw new Error('MARKETING_METRIC_INVALID')
  const result=Number(value);if(!Number.isFinite(result)||result<0)throw new Error('MARKETING_METRIC_INVALID');return result
}
function sum(values:Array<number|null>):number|null{return values.some(value=>value===null)?null:values.reduce<number>((total,value)=>total+value!,0)}
function currency(value:unknown):string|null{return typeof value==='string'&&/^[A-Z]{3}$/.test(value)?value:null}

function normalize(connector:Connector,date:string,input:unknown):Daily{
  const data=object(input),metrics:Record<string,number|null>={},money:Money[]=[]
  if(connector==='ga4'){
    const totals=object(data.totals),headers=rows(totals.metricHeaders),dailyRows=rows(totals.rows)
    for(const [key,name]of Object.entries({activeUsers:'activeUsers',sessions:'sessions',pageViews:'screenPageViews',keyEvents:'keyEvents'})){
      const index=headers.findIndex(header=>header.name===name)
      metrics[key]=index<0?null:sum(dailyRows.map(row=>number(rows(row.metricValues)[index]?.value)))
    }
  }else if(connector==='googleAds'){
    const dailyRows=rows(data.rows)
    for(const key of ['impressions','clicks','conversions'])metrics[key]=sum(dailyRows.map(row=>number(object(row.metrics)[key])))
    for(const row of dailyRows){const amount=number(object(row.metrics).cost_micros);money.push({date,amount:amount===null?null:amount/1000000,currency:currency(row.customer?object(row.customer).currency_code:undefined)})}
    if(!dailyRows.length)money.push({date,amount:0,currency:null})
  }else if(connector==='meta'){
    const dailyRows=rows(data.rows)
    for(const key of ['impressions','clicks'])metrics[key]=sum(dailyRows.map(row=>number(row[key])))
    for(const [key,type]of Object.entries({platformLeads:'lead',websiteLeads:'offsite_conversion.fb_pixel_lead',onsiteLeads:'onsite_conversion.lead_grouped'}))metrics[key]=sum(dailyRows.map(row=>{const action=rows(row.actions).find(action=>action.action_type===type);return action?number(action.value):null}))
    for(const row of dailyRows)money.push({date,amount:number(row.spend),currency:currency(row.account_currency)})
    if(!dailyRows.length)money.push({date,amount:0,currency:null})
  }else{
    const dailyRows=rows(data.rows)
    for(const key of ['clicks','impressions'])metrics[key]=sum(dailyRows.map(row=>number(row[key])))
  }
  return {date,metrics,money}
}
function attributionSource(payload:unknown):Source{
  const raw=payload&&typeof payload==='object'&&!Array.isArray(payload)?(payload as Record<string,unknown>).attribution:undefined
  const attribution=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{}
  const text=(key:string)=>typeof attribution[key]==='string'?(attribution[key] as string).trim().toLowerCase():''
  const paid=['cpc','ppc','paid','paidsearch','paid_search','paid_social','paidsocial','social_paid'].includes(text('utm_medium'))
  const google=!!(text('gclid')||text('gbraid')||text('wbraid'))||(paid&&['google','googleads','adwords'].includes(text('utm_source')))
  const meta=!!(text('fbclid')||text('fbc'))||(paid&&['facebook','instagram','meta','fb','ig'].includes(text('utm_source')))
  return google&&meta?'ambiguous':google?'googleAds':meta?'meta':'other'
}
async function scope(userId:string,siteId:string,draftId:string|undefined,database:pg.Pool){
  const site=(await database.query('SELECT s.* FROM sites s JOIN site_owners o USING(site_id) WHERE s.site_id=$1 AND o.user_id=$2',[siteId,userId])).rows[0]
  if(!site)throw new Error('FORBIDDEN')
  const draft=(await database.query("SELECT d.* FROM site_drafts d JOIN draft_owners o USING(draft_id) WHERE d.site_id=$1 AND o.user_id=$2 AND ($3::text IS NULL OR d.draft_id=$3) ORDER BY d.updated_at DESC LIMIT 1",[siteId,userId,draftId??null])).rows[0]
  if((draftId||site.status!=='published')&&!draft)throw new Error('FORBIDDEN')
  return {key:site.status==='published'?`site:${siteId}`:draft?`draft:${draft.draft_id}`:null,draftId:draft?.draft_id as string|undefined}
}

export async function readCmsMarketingMetrics(userId:string,siteId:string,database:pg.Pool=pool,draftId?:string,now=new Date()){
  const current=await scope(userId,siteId,draftId,database)
  const end=now.toISOString().slice(0,10),from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-29)).toISOString().slice(0,10)
  const until=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)).toISOString()
  const [stored,connections,inquiryRows,native]=await Promise.all([
    database.query('SELECT connector,date::text AS date,data,updated_at FROM marketing_metrics WHERE site_id=$1 AND scope_key=$2 AND date>=$3 AND date<=$4 ORDER BY date',[siteId,current.key,from,end]),
    database.query('SELECT connector,status,last_synced_at FROM integration_connections WHERE site_id=$1 AND scope_key=$2',[siteId,current.key]),
    database.query("SELECT i.payload,(i.created_at AT TIME ZONE 'UTC')::date::text AS date,(i.status='qualified' OR EXISTS(SELECT 1 FROM cms_outbound_tasks t WHERE t.inquiry_id=i.inquiry_id AND t.kind='qualified_conversion')) AS qualified FROM inquiries i WHERE i.site_id=$1 AND i.source='public' AND i.created_at>=$2 AND i.created_at<$3",[siteId,`${from}T00:00:00Z`,until]),
    database.query("SELECT count(*)::int AS views FROM cms_public_events WHERE site_id=$1 AND name='page_view' AND created_at>=$2 AND created_at<$3",[siteId,`${from}T00:00:00Z`,until]),
  ])
  const inquiries:Inquiry[]=inquiryRows.rows.map(row=>({date:row.date,source:attributionSource(row.payload),qualified:row.qualified}))
  const platforms:MarketingPlatform[]=(['ga4','googleAds','meta','searchConsole'] as Connector[]).map(connector=>{
    const records=stored.rows.filter(row=>row.connector===connector),days=records.map(row=>normalize(connector,row.date,row.data)),connection=connections.rows.find(row=>row.connector===connector)
    const metrics=Object.fromEntries(metricNames[connector].map(key=>{const available=days.map(day=>day.metrics[key]).filter((value):value is number=>value!==null&&value!==undefined);return [key,{value:available.length?sum(available):null,days:available.length}]}))
    const amounts=days.flatMap(day=>day.money),known=amounts.filter((money):money is Money&{currency:string;amount:number}=>money.currency!==null&&money.amount!==null)
    const spend:Spend[]=[...new Set(known.map(money=>money.currency))].sort().map(unit=>{
      const group=known.filter(money=>money.currency===unit),dates=new Set(group.map(money=>money.date))
      const ambiguous=amounts.some(money=>dates.has(money.date)&&(money.amount===null||money.currency===null||money.currency!==unit))
      const matched=inquiries.filter(inquiry=>inquiry.source===connector&&dates.has(inquiry.date)),qualified=matched.filter(inquiry=>inquiry.qualified).length
      const amount=group.reduce((total,money)=>total+money.amount,0)
      const reason=ambiguous?'同期存在未返回金额、多个币种或币种不明的花费，无法计算来源询盘成本。':!matched.length?'已同步花费的日期没有可归因的公开询盘。':null
      return {currency:unit,amount,days:dates.size,inquiries:matched.length,qualified,costPerInquiry:reason?null:amount/matched.length,costPerQualifiedInquiry:ambiguous||!qualified?null:amount/qualified,costUnavailableReason:reason}
    })
    return {connector,status:!records.length?'not_synced':records.length===30?'synced':'partial',availableDays:records.length,expectedDays:30,lastSyncedAt:connection?.last_synced_at?new Date(connection.last_synced_at).toISOString():records.length?new Date(Math.max(...records.map(row=>new Date(row.updated_at).getTime()))).toISOString():null,connectionStatus:connection?.status??'not_connected',metrics,spend,unknownSpend:amounts.filter(money=>money.currency===null).map(money=>({date:money.date,amount:money.amount})),sourceInquiries:inquiries.filter(inquiry=>inquiry.source===connector).length,qualifiedSourceInquiries:inquiries.filter(inquiry=>inquiry.source===connector&&inquiry.qualified).length}
  })
  return {period:{from,to:end,timeZone:'UTC',days:30},platforms,native:{pageViews:Number(native.rows[0].views)},inquiries:{total:inquiries.length,qualified:inquiries.filter(inquiry=>inquiry.qualified).length,sources:(['googleAds','meta','ambiguous','other'] as Source[]).map(source=>({source,total:inquiries.filter(inquiry=>inquiry.source===source).length,qualified:inquiries.filter(inquiry=>inquiry.source===source&&inquiry.qualified).length}))}}
}

export async function readCmsOverview(userId:string,siteId:string,draftId:string,locale:string,database:pg.Pool=pool){
  await scope(userId,siteId,draftId,database)
  const [counts,marketing]=await Promise.all([database.query('SELECT (SELECT count(*)::int FROM pages WHERE draft_id=$1 AND locale=$2) AS pages,(SELECT count(*)::int FROM collection_indexes WHERE draft_id=$1 AND locale=$2) AS collections,(SELECT count(*)::int FROM collection_groups WHERE draft_id=$1 AND locale=$2) AS groups,(SELECT count(*)::int FROM collection_items WHERE draft_id=$1 AND locale=$2) AS items',[draftId,locale]),readCmsMarketingMetrics(userId,siteId,database,draftId)])
  return {counts:counts.rows[0] as {pages:number;collections:number;groups:number;items:number},marketing}
}

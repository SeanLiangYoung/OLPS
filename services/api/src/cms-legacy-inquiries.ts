import { createHash } from 'node:crypto'
import type pg from 'pg'

function historicalId(siteId:string,inquiryId:string):string{
  const digest=createHash('sha256').update(`olps:legacy-inquiry:${siteId}:${inquiryId}`).digest('hex')
  return`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`
}
function record(value:unknown):Record<string,unknown>{return value!==null && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:{}}
export async function migrateLegacyInquiries(database:pg.Pool):Promise<number>{
  const client=await database.connect()
  try{
    await client.query('BEGIN')
    const inquiries=await client.query('SELECT i.*,s.settings FROM inquiries i JOIN sites s USING(site_id) WHERE i.cms_id IS NULL ORDER BY i.inquiry_id FOR UPDATE OF i')
    const statuses:Record<string,string>={new:'new',qualified:'qualified',invalid:'invalid',handled:'handled',read:'handled',contacted:'handled',converted:'qualified',won:'qualified',lost:'invalid',spam:'invalid',archived:'handled',closed:'handled'}
    for(const inquiry of inquiries.rows){
      const legacyPayload=record(inquiry.payload),originalFields=record(legacyPayload.fields)
      const value=(key:string)=>typeof originalFields[key]==='string'?originalFields[key]:typeof legacyPayload[key]==='string'?legacyPayload[key]:''
      const sourceLocale=typeof legacyPayload.locale==='string'?legacyPayload.locale:record(inquiry.settings).defaultLocale
      const page=await client.query('SELECT page_id,locale,title FROM pages WHERE draft_id=$1 AND page_id=$2 ORDER BY (locale=$3) DESC,locale LIMIT 1',[inquiry.draft_id,inquiry.page_id,sourceLocale??'en'])
      const associated=page.rows[0]
      const status=statuses[inquiry.status]
      if(!status)throw new Error(`历史询盘状态需要人工检查：${inquiry.status}`)
      const attribution={...record(legacyPayload.attribution)}
      for(const key of ['gclid','gbraid','wbraid','fbclid','ttclid','msclkid','utm_source','utm_medium','utm_campaign','utm_term','utm_content','landingUrl','referrer'])if(typeof legacyPayload[key]==='string' && attribution[key]===undefined)attribution[key]=legacyPayload[key]
      const payload={...legacyPayload,fields:{...originalFields,name:value('name'),email:value('email'),message:value('message')},attribution,contentTitle:associated?.title??legacyPayload.pageTitle??'',legacyPayload,legacyStatus:inquiry.status}
      const locale=associated?.locale??(typeof sourceLocale==='string'?sourceLocale:'en')
      const target=inquiry.page_id?{ref:'page',id:inquiry.page_id}:null
      await client.query('UPDATE inquiries SET cms_id=$1,source=$2,locale=$3,target=$4,payload=$5,status=$6 WHERE inquiry_id=$7 AND cms_id IS NULL',[historicalId(inquiry.site_id,String(inquiry.inquiry_id)),inquiry.source==='preview'?'preview':'public',locale,target,payload,status,inquiry.inquiry_id])
    }
    await client.query('COMMIT');return inquiries.rowCount??0
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

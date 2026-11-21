import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { expect,it } from 'vitest'
import { migrateWithClient,pool,recreatePool } from './db.js'
import { createCmsSite,initializeCmsSite } from './cms-sites.js'
import { migrateCmsRuntime } from './cms-runtime-schema.js'
import { migrateLegacyInquiries } from './cms-legacy-inquiries.js'
import { CmsPreviewService } from './cms-preview.js'
import { createCmsPublicRoutes } from './cms-public-routes.js'
import { createSession } from './sessions.js'

it('旧询盘转换为稳定历史记录，真实HTTP列表可见，重复执行不修改行且撤权拒绝',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许专用测试数据库')
  const schema=`inquiries_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const priorSchema=process.env.PG_TEST_SCHEMA
  await pool.end();process.env.PG_TEST_SCHEMA=schema;recreatePool()
  const root=path.resolve('../../.intermediate/cms-legacy-inquiries',schema)
  let server:ReturnType<typeof serve>|undefined
  try{
    const client=await database.connect();await migrateWithClient(client);client.release()
    for(const userId of ['owner','viewer'])await database.query("INSERT INTO users VALUES($1,$1,'password',$1,NOW(),NOW())",[userId])
    const site=await createCmsSite('owner','Legacy inquiries',database,root)
    expect(await initializeCmsSite('owner',site.siteId,database,root)).toEqual({initStatus:'ready'})
    await database.query('INSERT INTO site_owners VALUES($1,$2,NOW())',[site.siteId,'viewer'])
    const original={name:'Existing visitor',email:'legacy@example.com',message:'Existing inquiry body',gclid:'stored-existing-ad-click',utm_campaign:'stored-campaign',customField:{preserve:true}}
    for(const status of ['new','converted','spam','contacted'])await database.query('INSERT INTO inquiries(draft_id,site_id,page_id,payload,status) VALUES($1,$2,$3,$4,$5)',[site.draftId,site.siteId,'11111111-1111-4111-8111-111111111103',original,status])
    await migrateCmsRuntime(database,{sandboxRoot:root,validationRoot:path.join(root,'validation')})
    const inquiries=(await database.query('SELECT *,xmin::text AS row_version FROM inquiries ORDER BY inquiry_id')).rows
    expect(inquiries.map(value=>value.status)).toEqual(['new','qualified','invalid','handled'])
    expect(new Set(inquiries.map(value=>value.cms_id)).size).toBe(4)
    for(const inquiry of inquiries){
      expect(inquiry.cms_id).toMatch(/^[a-f\d-]{36}$/)
      expect(inquiry.source).toBe('public');expect(inquiry.locale).toBe('en')
      expect(inquiry.target).toEqual({ref:'page',id:'11111111-1111-4111-8111-111111111103'})
      expect(inquiry.payload.legacyPayload).toEqual(original)
      expect(inquiry.payload.fields).toEqual({name:original.name,email:original.email,message:original.message})
      expect(inquiry.payload.attribution).toEqual({gclid:original.gclid,utm_campaign:original.utm_campaign})
    }
    expect((await database.query('SELECT * FROM cms_outbound_tasks')).rowCount).toBe(0)
    expect((await database.query('SELECT * FROM conversion_deliveries')).rowCount).toBe(0)
    expect(await migrateLegacyInquiries(database)).toBe(0)
    expect((await database.query('SELECT *,xmin::text AS row_version FROM inquiries ORDER BY inquiry_id')).rows).toEqual(inquiries)
    const token=randomUUID();await createSession('viewer',token)
    const app=new Hono();app.route('/api',createCmsPublicRoutes(new CmsPreviewService(database,root,path.join(root,'previews'))))
    const address=await new Promise<string>(resolve=>{server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0},info=>resolve(`http://127.0.0.1:${info.port}`))})
    const response=await fetch(`${address}/api/sites/${site.siteId}/inquiries`,{headers:{Authorization:`Bearer ${token}`}})
    expect(response.status).toBe(200)
    const body=await response.json() as {inquiries:Array<{inquiryId:string;payload:{fields:{message:string}}}>}
    expect(body.inquiries).toHaveLength(4);expect(body.inquiries[0]!.payload.fields.message).toBe(original.message)
    const headers={Authorization:`Bearer ${token}`}
    type Page={inquiries:Array<{inquiryId:string;status:string}>;pageInfo:{hasNextPage:boolean;nextCursor:string|null}}
    const first=await(await fetch(`${address}/api/sites/${site.siteId}/inquiries?limit=2`,{headers})).json() as Page
    expect(first.inquiries).toHaveLength(2);expect(first.pageInfo.hasNextPage).toBe(true)
    const second=await(await fetch(`${address}/api/sites/${site.siteId}/inquiries?limit=2&cursor=${encodeURIComponent(first.pageInfo.nextCursor!)}`,{headers})).json() as Page
    expect(second.inquiries).toHaveLength(2);expect(second.pageInfo.hasNextPage).toBe(false)
    expect(new Set([...first.inquiries,...second.inquiries].map(value=>value.inquiryId)).size).toBe(4)
    const qualified=await(await fetch(`${address}/api/sites/${site.siteId}/inquiries?status=qualified&q=Existing&locale=en`,{headers})).json() as Page
    expect(qualified.inquiries.map(value=>value.status)).toEqual(['qualified'])
    const otherLocale=await(await fetch(`${address}/api/sites/${site.siteId}/inquiries?locale=zh-CN`,{headers})).json() as Page
    expect(otherLocale.inquiries).toEqual([])
    const invalid=await fetch(`${address}/api/sites/${site.siteId}/inquiries?limit=101`,{headers})
    expect(invalid.status).toBe(400);expect(await invalid.json()).toMatchObject({code:'VALIDATION_FAILED',details:{issues:expect.any(Array)}})
    const unknownField=await fetch(`${address}/api/public/${site.siteId}/inquiries`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unexpected:true})})
    expect(unknownField.status).toBe(400);expect(await unknownField.json()).toMatchObject({code:'VALIDATION_FAILED',details:{issues:expect.any(Array)}})
    await database.query('DELETE FROM site_owners WHERE site_id=$1 AND user_id=$2',[site.siteId,'viewer'])
    const forbidden=await fetch(`${address}/api/sites/${site.siteId}/inquiries`,{headers:{Authorization:`Bearer ${token}`}})
    expect(forbidden.status).toBe(403);expect(await forbidden.json()).toMatchObject({code:'FORBIDDEN'})
    expect((await database.query('SELECT * FROM cms_outbound_tasks')).rowCount).toBe(0)
  }finally{
    if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()))
    await pool.end();if(priorSchema===undefined)delete process.env.PG_TEST_SCHEMA;else process.env.PG_TEST_SCHEMA=priorSchema;recreatePool()
    await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})
  }
},120000)

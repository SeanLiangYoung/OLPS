import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { Hono } from 'hono'
import { expect,it } from 'vitest'
import { migrateWithClient, pool, recreatePool } from './db.js'
import { migrateCmsSchema } from './cms-schema.js'
import { createContentIndexSchema } from './content-index.js'
import { createCmsSite,initializeCmsSite } from './cms-sites.js'
import { createSession,createAccessToken } from './sessions.js'
import { contentRoutes } from './content-routes.js'
import { appConfig } from './config.js'

it('真实会话内容HTTP保存、revision冲突、删除和权限检查',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_')) throw new Error('只允许测试数据库')
  const schema=`content_http_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url})
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const previousSchema=process.env.PG_TEST_SCHEMA
  process.env.PG_TEST_SCHEMA=schema
  recreatePool()
  const client=await pool.connect()
  let sandboxId:string|undefined
  try{
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    await migrateCmsSchema(client)
    await createContentIndexSchema(client)
    const created=await createCmsSite('owner','HTTP content')
    const draftId=created.draftId
    expect(await initializeCmsSite('owner',created.siteId)).toEqual({initStatus:'ready'})
    sandboxId=(await client.query('SELECT sandbox_id FROM site_drafts WHERE draft_id=$1',[draftId])).rows[0].sandbox_id
    const token=createAccessToken()
    await createSession('owner',token)
    const app=new Hono().route('/api',contentRoutes)
    const pageId=randomUUID()
    const now=new Date().toISOString()
    const content={ref:'page',meta:{schemaVersion:1,pageId,role:null,template:'page',status:'draft',createdAt:now,updatedAt:now},locale:{schemaVersion:1,locale:'en',slug:'http-content',title:'HTTP content',summary:'',cover:null,seo:{title:'HTTP',description:'',ogImage:null},blocks:[],sourceHash:null,updatedAt:now}}
    const request=(method:string,suffix:string,body?:unknown,revision?:string)=>app.request(`/api/drafts/${draftId}${suffix}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(revision?{'If-Match':`"${revision}"`}:{})},body:body?JSON.stringify(body):undefined})
    const response=await request('POST','/pages',content)
    expect(response.status,await response.clone().text()).toBe(201)
    const saved=await response.json()
    const duplicate=await request('POST','/pages',{...content,meta:{...content.meta,pageId:randomUUID()}})
    expect(duplicate.status).toBe(409)
    const read=await request('GET',`/content/page/${pageId}?locale=en`)
    expect(read.status).toBe(200)
    const updated=await request('PUT',`/content/page/${pageId}`,{...content,locale:{...content.locale,title:'Updated'}},saved.revision)
    expect(updated.status,await updated.clone().text()).toBe(200)
    expect((await request('PUT',`/content/page/${pageId}`,content,saved.revision)).status).toBe(409)
    const listing=await request('GET','/pages?locale=en&q=Updated')
    expect((await listing.json()).pages).toHaveLength(1)
    const current=await updated.json()
    expect((await request('DELETE',`/content/page/${pageId}`,undefined,current.revision)).status).toBe(204)
    expect((await request('GET',`/content/page/${pageId}`)).status).toBe(404)
    expect((await app.request(`/api/drafts/${draftId}/content/page/${pageId}`)).status).toBe(401)
  }finally{
    client.release()
    await pool.end()
    if(previousSchema===undefined)delete process.env.PG_TEST_SCHEMA
    else process.env.PG_TEST_SCHEMA=previousSchema
    recreatePool()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
    if(sandboxId)await fs.rm(path.join(appConfig.sandboxRoot,sandboxId),{recursive:true,force:true})
  }
},120000)

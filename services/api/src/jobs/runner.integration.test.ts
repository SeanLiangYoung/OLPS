import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { Hono } from 'hono'
import { expect,it } from 'vitest'
import { migrateWithClient,pool,recreatePool } from '../db.js'
import { migrateCmsSchema } from '../cms-schema.js'
import { createCmsSite,initializeCmsSite } from '../cms-sites.js'
import { fetchDraftRow,openDraftWorkspaceFromRow } from '../draft-preview-support.js'
import { createSession,createAccessToken } from '../sessions.js'
import { appConfig } from '../config.js'
import { submitCmsJob,runCmsJob } from './runner.js'
import { readJobEvents } from './events.js'
import { cmsJobRoutes } from './routes.js'
import { readContent,saveContentBatch } from '../content-sandbox.js'
import { validateGeneratedContent } from './schema.js'

it('真实任务持久事件、幂等键、SSE断点与模型失败内容保护',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许测试数据库')
  const schema=`jobs_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url})
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const prior=process.env.PG_TEST_SCHEMA
  process.env.PG_TEST_SCHEMA=schema
  recreatePool()
  const client=await pool.connect()
  let sandboxId:string|undefined
  try{
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    await migrateCmsSchema(client)
    const site=await createCmsSite('owner','AI jobs')
    expect(await initializeCmsSite('owner',site.siteId)).toEqual({initStatus:'ready'})
    const row=await fetchDraftRow(site.draftId)
    sandboxId=String(row.sandbox_id)
    const workspace=await openDraftWorkspaceFromRow(row)
    const context={workspace,database:pool,draftId:site.draftId,userId:'owner'}
    const files=async()=>{const result:Record<string,string>={};for(const file of await workspace.listFiles('source'))result[file]=(await workspace.readFile(file)).toString('base64');return result}
    const before=await files()
    const syncBefore=(await client.query('SELECT sync_status FROM site_drafts WHERE draft_id=$1',[site.draftId])).rows[0].sync_status
    const request={draftId:site.draftId,locale:'en',instruction:'Propose one short About Us page. Do not create unsupported claims.'}
    const job=await submitCmsJob(context,'propose_site_structure',request,'proposal')
    expect((await submitCmsJob(context,'propose_site_structure',request,'proposal')).jobId).toBe(job.jobId)
    await expect(submitCmsJob(context,'propose_site_structure',{...request,instruction:'Different request'},'proposal')).rejects.toThrow('REVISION_CONFLICT')
    await expect(submitCmsJob(context,'propose_site_structure',{...request,knowledgeDocumentIds:[randomUUID()]},'forbidden-document')).rejects.toThrow('FORBIDDEN')
    await runCmsJob(context,job.jobId)
    const stored=(await client.query('SELECT * FROM jobs WHERE job_id=$1',[job.jobId])).rows[0]
    if(process.env.AI_API_KEY)expect(stored.status,stored.error).toBe('completed')
    else{expect(stored.status).toBe('failed');expect(stored.error).toContain('AI_API_KEY')}
    expect(await files()).toEqual(before)
    expect((await client.query('SELECT sync_status FROM site_drafts WHERE draft_id=$1',[site.draftId])).rows[0].sync_status).toBe(syncBefore)
    const events=await readJobEvents(pool,job.jobId,0)
    expect(events.map(event=>event.eventId)).toEqual(events.map((_,index)=>index+1))
    expect((await readJobEvents(pool,job.jobId,events[0].eventId)).map(event=>event.eventId)).toEqual(events.slice(1).map(event=>event.eventId))
    const token=createAccessToken()
    await createSession('owner',token)
    const app=new Hono().route('/api',cmsJobRoutes)
    const response=await app.request(`/api/jobs/${job.jobId}/events`,{headers:{Authorization:`Bearer ${token}`,'Last-Event-ID':String(events[0].eventId)}})
    expect(response.status).toBe(200)
    const stream=await response.text()
    expect(stream).not.toContain('id: 1\n')
    for(const event of events.slice(1))expect(stream).toContain(`id: ${event.eventId}\n`)
    await client.query("UPDATE jobs SET created_at=NOW()-INTERVAL '25 hours' WHERE job_id=$1",[job.jobId])
    expect((await submitCmsJob(context,'propose_site_structure',request,'proposal')).jobId).not.toBe(job.jobId)
    const source=(await readContent(context,'page','11111111-1111-4111-8111-111111111102','en'))
    const reader={readText:async(file:string)=>(await workspace.readFile(file)).toString(),list:async(directory:string)=>[...new Set((await workspace.listFiles(directory)).map(file=>file.slice(directory.length+1).split('/')[0]))]}
    const invalid=structuredClone(source.content)
    invalid.locale.blocks=[{id:'invalid',type:'core/text',props:{content:42},children:[]}]
    await expect(validateGeneratedContent(invalid,reader,'starter',[])).rejects.toThrow('VALIDATION_FAILED')
    expect(await files()).toEqual(before)
    const first=structuredClone(source.content)
    first.locale.title='Current title'
    await saveContentBatch(context,[{content:first,revision:source.revision}])
    const current=await files()
    await expect(saveContentBatch(context,[{content:source.content,revision:source.revision}])).rejects.toThrow('REVISION_CONFLICT')
    expect(await files()).toEqual(current)
  }finally{
    client.release()
    await pool.end()
    if(prior===undefined)delete process.env.PG_TEST_SCHEMA
    else process.env.PG_TEST_SCHEMA=prior
    recreatePool()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
    if(sandboxId)await fs.rm(path.join(appConfig.sandboxRoot,sandboxId),{recursive:true,force:true})
  }
},180000)

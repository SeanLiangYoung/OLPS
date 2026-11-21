import { Hono,type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { getAuthUser,requireAuth,type AuthVariables } from '../auth-middleware.js'
import { pool } from '../db.js'
import { fetchDraftRow,openDraftWorkspaceFromRow } from '../draft-preview-support.js'
import { ContentError,type ContentContext } from '../content-sandbox.js'
import { resourceErrorResponse } from '../managed-resource-context.js'
import { submitCmsJob,runCmsJob } from './runner.js'
import { jobTypes,jobRequestSchema } from './schema.js'
import { readJobEvents } from './events.js'

export const cmsJobRoutes=new Hono<{Variables:AuthVariables}>()
cmsJobRoutes.use('/jobs/*',requireAuth)

async function contextFor(draftId:string,c:Context):Promise<ContentContext>{
  const userId=getAuthUser(c).userId
  const row=await pool.query('SELECT 1 FROM draft_owners WHERE draft_id=$1 AND user_id=$2',[draftId,userId])
  if(!row.rowCount)throw new ContentError('FORBIDDEN')
  return {userId,draftId,database:pool,workspace:await openDraftWorkspaceFromRow(await fetchDraftRow(draftId))}
}

cmsJobRoutes.post('/jobs/:type',async c=>{
  try{
    const type=z.enum(jobTypes).parse(c.req.param('type'))
    const input=jobRequestSchema.parse(await c.req.json())
    const context=await contextFor(input.draftId,c)
    const job=await submitCmsJob(context,type,input,c.req.header('Idempotency-Key')??'')
    if(job.status==='queued')queueMicrotask(()=>{void runCmsJob(context,job.jobId).catch(error=>console.error(error))})
    return c.json({job},202)
  }catch(error){
    if(error instanceof z.ZodError)return c.json({error:'生成请求结构无效',code:'VALIDATION_FAILED',details:{issues:error.issues}},400)
    return resourceErrorResponse(error,c)
  }
})

cmsJobRoutes.get('/jobs/:jobId',async c=>{
  const job=await pool.query('SELECT * FROM jobs WHERE job_id=$1 AND user_id=$2',[c.req.param('jobId'),getAuthUser(c).userId])
  if(!job.rowCount)return c.json({error:'任务不存在',code:'NOT_FOUND'},404)
  try{await contextFor(job.rows[0].draft_id,c)}catch(error){return resourceErrorResponse(error,c)}
  const row=job.rows[0]
  return c.json({job:{jobId:row.job_id,type:row.type,status:row.status,result:row.result,error:row.error}})
})

cmsJobRoutes.get('/jobs/:jobId/events',async c=>{
  const jobId=c.req.param('jobId')
  const row=await pool.query('SELECT * FROM jobs WHERE job_id=$1 AND user_id=$2',[jobId,getAuthUser(c).userId])
  if(!row.rowCount)return c.json({error:'任务不存在',code:'NOT_FOUND'},404)
  try{await contextFor(row.rows[0].draft_id,c)}catch(error){return resourceErrorResponse(error,c)}
  const last=Number(c.req.header('Last-Event-ID')??'0')
  if(!Number.isSafeInteger(last)||last<0)return c.json({error:'事件序号无效',code:'VALIDATION_FAILED'},400)
  return streamSSE(c,async stream=>{
    let after=last
    while(!stream.aborted){
      await contextFor(row.rows[0].draft_id,c)
      for(const event of await readJobEvents(pool,jobId,after)){
        await stream.writeSSE({id:String(event.eventId),event:event.type,data:JSON.stringify(event)})
        after=event.eventId
      }
      const current=await pool.query('SELECT status FROM jobs WHERE job_id=$1',[jobId])
      if(!current.rowCount||['completed','failed'].includes(current.rows[0].status))break
      await stream.sleep(250)
    }
  })
})

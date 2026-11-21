import { Hono,type Context } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { requireAuth,getAuthUser,type AuthVariables } from './auth-middleware.js'
import { pool } from './db.js'
import { createInquiry,createPublicEvent,setInquiryStatus } from './cms-public.js'
import { runCmsSiteReport,readCmsReportHistory,readCmsReport } from './cms-reports.js'
import { retryInquiryDelivery } from './inquiry-delivery.js'

type PreviewResolver={resolve(token:string):Promise<Record<string,unknown>>}
function clientAddress(c:Context):string{return (c.env as {incoming?:{socket:{remoteAddress?:string}}}|undefined)?.incoming?.socket.remoteAddress??'unknown'}
function errorResponse(error:unknown,c:Context):Response{
  if(error instanceof z.ZodError) return c.json({error:'提交内容无效',code:'VALIDATION_FAILED',details:{issues:error.issues}},400)
  if(error instanceof SyntaxError || error instanceof URIError) return c.json({error:'提交内容格式无效',code:'VALIDATION_FAILED'},400)
  const message=error instanceof Error?error.message:String(error)
  if(message==='FORBIDDEN' || message==='PREVIEW_FORBIDDEN') return c.json({error:'无权访问',code:'FORBIDDEN'},403)
  if(message==='NOT_FOUND') return c.json({error:'记录不存在',code:'NOT_FOUND'},404)
  if(message==='INQUIRY_RATE_LIMIT') return c.json({error:'提交过于频繁，请稍后重试',code:'RATE_LIMITED'},429)
  if(message==='PUBLISHED_SNAPSHOT_UNAVAILABLE') return c.json({error:'网站发布内容暂不可用',code:'REMOTE_UNAVAILABLE'},503)
  if(message.startsWith('INQUIRY_') || message==='EVENT_TOO_LARGE') return c.json({error:message,code:'VALIDATION_FAILED'},400)
  throw error
}
export function createCmsPublicRoutes(previews:PreviewResolver):Hono<{Variables:AuthVariables}>{
  const routes=new Hono<{Variables:AuthVariables}>()
  routes.use('/public/*',cors())
  routes.use('/public/*',bodyLimit({maxSize:64000,onError:c=>c.json({error:'提交内容超过大小限制',code:'VALIDATION_FAILED'},400)}))
  routes.use('/preview-access/*/inquiries',bodyLimit({maxSize:64000,onError:c=>c.json({error:'提交内容超过大小限制',code:'VALIDATION_FAILED'},400)}))
  routes.post('/public/:siteId/inquiries',async c=>{
    try{return c.json(await createInquiry({siteId:c.req.param('siteId'),source:'public',request:await c.req.json(),clientKey:clientAddress(c)}),201)}catch(error){return errorResponse(error,c)}
  })
  routes.post('/public/:siteId/events',async c=>{
    try{await createPublicEvent(c.req.param('siteId'),await c.req.json(),pool,clientAddress(c));return c.json({accepted:true},202)}catch(error){return errorResponse(error,c)}
  })
  routes.post('/preview-access/:token/inquiries',async c=>{
    try{
      const capability=await previews.resolve(c.req.param('token'))
      const draft=await pool.query('SELECT site_id FROM site_drafts WHERE draft_id=$1',[capability.draft_id])
      if(!draft.rowCount) return c.json({error:'草稿不存在',code:'NOT_FOUND'},404)
      return c.json(await createInquiry({siteId:draft.rows[0].site_id,draftId:String(capability.draft_id),source:'preview',request:await c.req.json(),clientKey:clientAddress(c)}),201)
    }catch(error){return errorResponse(error,c)}
  })
  routes.get('/sites/:siteId/inquiries',requireAuth,async c=>{
    try{
    const siteId=c.req.param('siteId')
    if(!(await pool.query('SELECT 1 FROM site_owners WHERE site_id=$1 AND user_id=$2',[siteId,getAuthUser(c).userId])).rowCount) return c.json({error:'无权访问',code:'FORBIDDEN'},403)
    const query=z.object({source:z.enum(['public','preview']).default('public'),locale:z.string().min(1).max(50).optional(),status:z.enum(['new','qualified','invalid','handled']).optional(),q:z.string().max(200).optional(),limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.string().min(1).max(1000).optional()}).strict().parse(c.req.query())
    let cursorId:string|null=null
    if(query.cursor){
      const bytes=Buffer.from(query.cursor,'base64url')
      if(bytes.toString('base64url')!==query.cursor)throw new Error('INQUIRY_CURSOR_INVALID')
      cursorId=z.object({inquiryId:z.string().regex(/^[1-9]\d*$/)}).strict().parse(JSON.parse(bytes.toString('utf8'))).inquiryId
    }
    const result=await pool.query(`SELECT i.inquiry_id AS "cursorId",i.cms_id AS "inquiryId",i.source,i.status,i.locale,i.target,i.payload,i.created_at AS "createdAt",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('taskId',t.task_id,'kind',t.kind,'status',t.status,'attempts',t.attempts,'error',t.last_error) ORDER BY t.created_at) FROM cms_outbound_tasks t WHERE t.inquiry_id=i.inquiry_id),'[]') AS deliveries
      FROM inquiries i WHERE i.site_id=$1 AND i.source=$2 AND i.cms_id IS NOT NULL
      AND ($3::text IS NULL OR i.locale=$3) AND ($4::text IS NULL OR i.status=$4)
      AND ($5::text IS NULL OR concat_ws(' ',i.payload->'fields'->>'name',i.payload->'fields'->>'email',i.payload->'fields'->>'message',i.payload->>'contentTitle') ILIKE $5)
      AND ($6::bigint IS NULL OR i.inquiry_id<$6) ORDER BY i.inquiry_id DESC LIMIT $7`,[siteId,query.source,query.locale??null,query.status??null,query.q?`%${query.q}%`:null,cursorId,query.limit+1])
    const hasNextPage=result.rows.length>query.limit,rows=result.rows.slice(0,query.limit)
    const nextCursor=hasNextPage?Buffer.from(JSON.stringify({inquiryId:String(rows.at(-1)!.cursorId)})).toString('base64url'):null
    return c.json({inquiries:rows.map(({cursorId,...inquiry})=>inquiry),pageInfo:{nextCursor,hasNextPage}})
    }catch(error){return errorResponse(error,c)}
  })
  routes.post('/sites/:siteId/inquiries/:inquiryId/deliveries/:taskId/retry',requireAuth,async c=>{
    try { await retryInquiryDelivery(getAuthUser(c).userId,c.req.param('siteId')!,c.req.param('inquiryId')!,c.req.param('taskId')!);return c.json({status:'pending'}) }
    catch(error){return errorResponse(error,c)}
  })
  routes.patch('/sites/:siteId/inquiries/:inquiryId',requireAuth,async c=>{
    try{
      const input=z.object({status:z.enum(['new','qualified','invalid','handled'])}).strict().parse(await c.req.json())
      await setInquiryStatus(getAuthUser(c).userId,c.req.param('siteId')!,c.req.param('inquiryId')!,input.status)
      return c.json({status:input.status})
    }catch(error){return errorResponse(error,c)}
  })
  routes.get('/sites/:siteId/reports',requireAuth,async c=>{
    try{return c.json(await runCmsSiteReport(getAuthUser(c).userId,c.req.param('siteId')!,pool,c.req.query('draftId')))}catch(error){return errorResponse(error,c)}
  })
  routes.get('/sites/:siteId/reports/history',requireAuth,async c=>{
    try{return c.json({reports:await readCmsReportHistory(getAuthUser(c).userId,c.req.param('siteId')!,pool)})}catch(error){return errorResponse(error,c)}
  })
  routes.get('/sites/:siteId/reports/:reportId',requireAuth,async c=>{
    try{return c.json(await readCmsReport(getAuthUser(c).userId,c.req.param('siteId')!,c.req.param('reportId')!,pool))}catch(error){return errorResponse(error,c)}
  })
  return routes
}

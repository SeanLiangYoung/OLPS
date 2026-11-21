import { Hono,type Context } from 'hono'
import { z } from 'zod'
import { requireAuth,getAuthUser,type AuthVariables } from './auth-middleware.js'
import { CmsPublicationService,PublicationBuildError } from './cms-publication.js'
import { isRemoteTransportError } from './push-remote-transport-error.js'
import { publicationResponse,publicationTargetResponse,publicationNotificationResponse } from './publication-response.js'

function respond(error:unknown,c:Context):Response{
  if(error instanceof PublicationBuildError)return c.json({error:error.message,code:'BUILD_FAILED',details:{validationLog:error.validationLog}},400)
  if(isRemoteTransportError(error) || (error instanceof Error && ['AbortError','TimeoutError'].includes(error.name)))return c.json({error:'远程托管暂时无法访问，请恢复连接后重试',code:'REMOTE_UNAVAILABLE'},503)
  if(error instanceof z.ZodError)return c.json({error:'发布参数无效',code:'VALIDATION_FAILED',details:{issues:error.issues}},400)
  if(error instanceof SyntaxError || error instanceof URIError)return c.json({error:'发布参数无效',code:'VALIDATION_FAILED'},400)
  const message=error instanceof Error?error.message:String(error)
  if(message==='FORBIDDEN')return c.json({error:'无权访问',code:'FORBIDDEN'},403)
  if(message==='NOT_FOUND')return c.json({error:'发布记录或目标不存在',code:'NOT_FOUND'},404)
  if(message.startsWith('REMOTE_404'))return c.json({error:'网站文件不存在',code:'NOT_FOUND'},404)
  if(message==='发布路径无效')return c.json({error:'网站文件地址无效',code:'VALIDATION_FAILED'},400)
  if(message==='历史发布只能下载，不能覆盖当前目标')return c.json({error:message,code:'RESOURCE_IN_USE'},409)
  if(message==='DRAFT_NOT_READY')return c.json({error:'网站状态已经变化，请重新检查后发布',code:'DRAFT_BUSY'},409)
  if(message==='PUBLISHED_VERSION_CHANGED')return c.json({error:'网站状态已经变化，请重新检查后发布',code:'DRAFT_CONFLICT'},409)
  if(message==='PUBLISH_merge_conflict' || message==='PUBLISH_awaiting_user')return c.json({error:'有内容需要确认，请查看协作说明',code:'DRAFT_CONFLICT'},409)
  throw error
}
export function createCmsPublicationRoutes(service:CmsPublicationService):Hono<{Variables:AuthVariables}>{
  const routes=new Hono<{Variables:AuthVariables}>()
  routes.get('/sites/:siteId/deploy-targets',requireAuth,async c=>{
    try{
      const query=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.string().min(1).max(1000).optional()}).strict().parse(c.req.query())
      let cursor:{name:string;targetId:string}|undefined
      if(query.cursor)cursor=z.object({name:z.string(),targetId:z.string().uuid()}).strict().parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')))
      const rows=await service.listTargets(getAuthUser(c).userId,c.req.param('siteId')!,{limit:query.limit+1,cursor}),hasNextPage=rows.length>query.limit,targets=rows.slice(0,query.limit),last=targets.at(-1)
      return c.json({targets,pageInfo:{hasNextPage,nextCursor:hasNextPage?Buffer.from(JSON.stringify({name:last.name,targetId:last.targetId})).toString('base64url'):null}})
    }catch(error){return respond(error,c)}
  })
  routes.post('/sites/:siteId/deploy-targets',requireAuth,async c=>{
    try{
      const input=z.object({targetId:z.string().uuid().optional(),name:z.string().trim().min(1).max(200),type:z.enum(['ftp','ftps','sftp','s3','oss','cos']),enabled:z.boolean(),config:z.record(z.string(),z.unknown())}).strict().parse(await c.req.json())
      const targetId=await service.saveTarget(getAuthUser(c).userId,c.req.param('siteId')!,input)
      return c.json({targetId},201)
    }catch(error){return respond(error,c)}
  })
  routes.delete('/sites/:siteId/deploy-targets/:targetId',requireAuth,async c=>{
    try{await service.deleteTarget(getAuthUser(c).userId,c.req.param('siteId')!,c.req.param('targetId')!);return c.body(null,204)}catch(error){return respond(error,c)}
  })
  routes.post('/sites/:siteId/deploy-targets/:targetId/test',requireAuth,async c=>{
    try{return c.json(await service.testTarget(getAuthUser(c).userId,c.req.param('siteId')!,c.req.param('targetId')!))}catch(error){return respond(error,c)}
  })
  routes.get('/sites/:siteId/site-files',requireAuth,async c=>{
    try{return await service.siteFiles(getAuthUser(c).userId,c.req.param('siteId')!)}catch(error){return respond(error,c)}
  })
  routes.get('/sites/:siteId/site-files/*',requireAuth,async c=>{
    try{const prefix=`/api/sites/${c.req.param('siteId')}/site-files/`;return await service.siteFiles(getAuthUser(c).userId,c.req.param('siteId')!,decodeURIComponent(c.req.path.slice(prefix.length)))}catch(error){return respond(error,c)}
  })
  routes.post('/sites/:siteId/publish',requireAuth,async c=>{
    try{
      const input=z.object({draftId:z.string().uuid(),requestKey:z.string().uuid()}).strict().parse(await c.req.json())
      const userId=getAuthUser(c).userId,siteId=c.req.param('siteId')!,record=await service.publish(userId,siteId,input.draftId,input.requestKey)
      return c.json({record:publicationResponse(await service.record(userId,siteId,record.record_id))})
    }catch(error){return respond(error,c)}
  })
  routes.post('/sites/:siteId/drafts/:draftId/pull',requireAuth,async c=>{
    try{return c.json(await service.pull(getAuthUser(c).userId,c.req.param('siteId')!,c.req.param('draftId')!))}catch(error){return respond(error,c)}
  })
  routes.get('/sites/:siteId/drafts/:draftId/synchronization',requireAuth,async c=>{
    try{return c.json(await service.synchronizationState(getAuthUser(c).userId,c.req.param('siteId')!,c.req.param('draftId')!))}catch(error){return respond(error,c)}
  })
  routes.post('/sites/:siteId/drafts/:draftId/continue',requireAuth,async c=>{
    try{const input=z.object({answer:z.string().trim().min(1).max(10000)}).strict().parse(await c.req.json()),userId=getAuthUser(c).userId,siteId=c.req.param('siteId')!;const result=await service.continue(userId,siteId,c.req.param('draftId')!,input.answer);return c.json({...result,...('record'in result?{record:publicationResponse(await service.record(userId,siteId,result.record.record_id))}:{})})}catch(error){return respond(error,c)}
  })
  routes.get('/sites/:siteId/publish-records',requireAuth,async c=>{
    try{
      const query=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.string().min(1).max(1000).optional()}).strict().parse(c.req.query())
      let cursor:{createdAt:string;recordId:string}|undefined
      if(query.cursor)cursor=z.object({createdAt:z.iso.datetime(),recordId:z.string().uuid()}).strict().parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')))
      const result=await service.records(getAuthUser(c).userId,c.req.param('siteId')!,{limit:query.limit+1,cursor}),hasNextPage=result.length>query.limit,rows=result.slice(0,query.limit)
      const last=rows.at(-1),nextCursor=hasNextPage?Buffer.from(JSON.stringify({createdAt:new Date(last.created_at).toISOString(),recordId:last.record_id})).toString('base64url'):null
      return c.json({records:rows.map(publicationResponse),pageInfo:{hasNextPage,nextCursor}})
    }catch(error){return respond(error,c)}
  })
  routes.get('/sites/:siteId/publish-records/:recordId/download.zip',requireAuth,async c=>{
    try{
      const response=await service.downloadZip(getAuthUser(c).userId,c.req.param('siteId')!,c.req.param('recordId')!)
      return new Response(response.body,{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${c.req.param('recordId')}.zip"`}})
    }catch(error){return respond(error,c)}
  })
  routes.get('/sites/:siteId/publish-records/:recordId',requireAuth,async c=>{
    try{return c.json({record:publicationResponse(await service.record(getAuthUser(c).userId,c.req.param('siteId')!,c.req.param('recordId')!))})}catch(error){return respond(error,c)}
  })
  routes.post('/sites/:siteId/publish-records/:recordId/targets/:targetId/retry',requireAuth,async c=>{
    try{return c.json({result:publicationTargetResponse(await service.retryTarget(getAuthUser(c).userId,c.req.param('siteId')!,c.req.param('recordId')!,c.req.param('targetId')!))})}catch(error){return respond(error,c)}
  })
  routes.post('/sites/:siteId/publish-records/:recordId/notifications/:provider/retry',requireAuth,async c=>{
    try{
      const provider=z.enum(['indexnow','search_console']).parse(c.req.param('provider'))
      return c.json({result:publicationNotificationResponse(await service.retryNotification(getAuthUser(c).userId,c.req.param('siteId')!,c.req.param('recordId')!,provider))})
    }catch(error){return respond(error,c)}
  })
  return routes
}

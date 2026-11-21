import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth,getAuthUser,type AuthVariables } from './auth-middleware.js'
import { createCmsSite,copySiteKnowledgeDocument,initializeCmsSite } from './cms-sites.js'
import { appConfig } from './config.js'
import { pool } from './db.js'

export const cmsSiteRoutes = new Hono<{Variables:AuthVariables}>()
cmsSiteRoutes.use('/sites',requireAuth)
cmsSiteRoutes.use('/sites/*',requireAuth)
cmsSiteRoutes.post('/sites',async c => {
  const input = z.object({name:z.string().trim().min(1).max(200),draftName:z.string().trim().min(1).max(200).optional()}).strict().safeParse(await c.req.json())
  if (!input.success) return c.json({error:'网站名称无效',code:'VALIDATION_FAILED',details:input.error.issues},400)
  const created = await createCmsSite(getAuthUser(c).userId,input.data.name,pool,appConfig.sandboxRoot,input.data.draftName)
  void initializeCmsSite(getAuthUser(c).userId,created.siteId)
  return c.json({site:{siteId:created.siteId,name:input.data.name,status:'unpublished'},draft:{draftId:created.draftId,siteId:created.siteId,initStatus:'initializing'},knowledgeBaseId:created.knowledgeBaseId},201)
})
cmsSiteRoutes.get('/sites/:siteId/initialization',async c => {
  const result = await pool.query('SELECT d.draft_id,d.init_status,d.last_error FROM site_drafts d JOIN site_owners o USING(site_id) WHERE d.site_id=$1 AND o.user_id=$2 ORDER BY d.created_at LIMIT 1',[c.req.param('siteId'),getAuthUser(c).userId])
  if (!result.rowCount) return c.json({error:'网站不存在',code:'NOT_FOUND'},404)
  return c.json({draftId:result.rows[0].draft_id,initStatus:result.rows[0].init_status,error:result.rows[0].last_error})
})
cmsSiteRoutes.post('/sites/:siteId/initialization/retry',async c => {
  try { return c.json(await initializeCmsSite(getAuthUser(c).userId,c.req.param('siteId'))) }
  catch (error) {
    if (error instanceof Error && error.message==='NOT_FOUND') return c.json({error:'网站不存在',code:'NOT_FOUND'},404)
    throw error
  }
})
cmsSiteRoutes.post('/sites/:siteId/knowledge-base/documents/:documentId/copy',async c => {
  const input = z.object({targetSiteIds:z.array(z.string().uuid()).min(1).max(100)}).strict().safeParse(await c.req.json())
  if (!input.success) return c.json({error:'目标网站无效',code:'VALIDATION_FAILED',details:input.error.issues},400)
  try {
    const copies = await copySiteKnowledgeDocument(getAuthUser(c).userId,c.req.param('siteId'),c.req.param('documentId'),input.data.targetSiteIds)
    return c.json({copies},201)
  } catch (error) {
    if (error instanceof Error && error.message==='NOT_FOUND') return c.json({error:'资料不存在',code:'NOT_FOUND'},404)
    if (error instanceof Error && error.message==='FORBIDDEN') return c.json({error:'无权访问目标网站',code:'FORBIDDEN'},403)
    throw error
  }
})

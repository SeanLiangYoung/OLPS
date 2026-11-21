import { Hono } from 'hono'
import { getAuthUser,requireAuth,type AuthVariables } from './auth-middleware.js'
import { readCmsMarketingMetrics,readCmsOverview } from './cms-marketing-metrics.js'

export const cmsOverviewRoutes=new Hono<{Variables:AuthVariables}>()
function responseError(error:unknown,c:Parameters<typeof getAuthUser>[0]):Response{if(error instanceof Error&&error.message==='FORBIDDEN')return c.json({code:'FORBIDDEN',error:'没有访问这个网站和编辑版本的权限'},403);throw error}
cmsOverviewRoutes.get('/sites/:siteId/marketing-metrics',requireAuth,async c=>{
  try{return c.json(await readCmsMarketingMetrics(getAuthUser(c).userId,c.req.param('siteId')!,undefined,c.req.query('draftId')))}catch(error){return responseError(error,c)}
})
cmsOverviewRoutes.get('/sites/:siteId/overview',requireAuth,async c=>{
  const draftId=c.req.query('draftId');if(!draftId)return c.json({code:'VALIDATION_FAILED',error:'请选择正在编辑的网站版本'},400)
  try{return c.json(await readCmsOverview(getAuthUser(c).userId,c.req.param('siteId')!,draftId,c.req.query('locale')??'en'))}catch(error){return responseError(error,c)}
})

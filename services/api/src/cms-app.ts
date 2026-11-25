import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { cmsSiteRoutes } from './cms-site-routes.js'
import { contentRoutes } from './content-routes.js'
import { cmsPreviewRoutes, cmsPreviews } from './cms-preview-routes.js'
import { createCmsPublicRoutes } from './cms-public-routes.js'
import { mediaRoutes } from './media-routes.js'
import { themeRoutes } from './theme-routes.js'
import { pluginRoutes } from './plugin-routes.js'
import { cmsManagementRoutes } from './cms-management-routes.js'
import { knowledgeImportRoutes } from './knowledge-import-routes.js'
import { cmsJobRoutes } from './jobs/routes.js'
import { cmsSourceRoutes } from './cms-source-routes.js'
import { cmsSettingsRoutes } from './cms-settings-routes.js'
import { integrationRoutes, notifySearchConsole } from './integration-routes.js'
import { CmsPublicationService } from './cms-publication.js'
import { createCmsPublicationRoutes } from './cms-publication-routes.js'
import { pool } from './db.js'
import { appConfig } from './config.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { authRoutes } from './auth-routes.js'
import { ownerRoutes } from './owner-routes.js'
import { localeRoutes } from './locale-routes.js'
import { cmsOverviewRoutes } from './cms-overview-routes.js'
import { createCmsPluginApiRoutes } from './cms-plugin-api.js'

export const cmsApp = new Hono()
cmsApp.onError((error,c)=>{
  if(error instanceof SyntaxError)return c.json({error:'提交内容的JSON格式无效',code:'INVALID_JSON'},400)
  console.error(error)
  return c.json({error:'服务暂时无法完成此操作，请联系管理员查看处理记录',code:'INTERNAL_ERROR'},500)
})
cmsApp.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type', 'If-Match', 'Idempotency-Key', 'Last-Event-ID'], exposeHeaders: ['ETag'] }))
cmsApp.get('/api/health', c => c.json({ ok: true }))
cmsApp.route('/api', authRoutes)
cmsApp.route('/api', ownerRoutes)
cmsApp.route('/api', localeRoutes)
cmsApp.route('/api', cmsSiteRoutes)
cmsApp.route('/api', cmsManagementRoutes)
cmsApp.route('/api', knowledgeImportRoutes)
cmsApp.route('/api', cmsOverviewRoutes)
cmsApp.route('/api', contentRoutes)
cmsApp.route('/api', mediaRoutes)
cmsApp.route('/api', themeRoutes)
cmsApp.route('/api', pluginRoutes)
cmsApp.route('/api', createCmsPublicRoutes(cmsPreviews))
cmsApp.route('/api', createCmsPluginApiRoutes(cmsPreviews))
cmsApp.route('/api', cmsJobRoutes)
cmsApp.route('/api', cmsSourceRoutes)
cmsApp.route('/api', cmsSettingsRoutes)
cmsApp.route('/api', integrationRoutes)
cmsApp.route('/api', createCmsPublicationRoutes(new CmsPublicationService(pool, appConfig.sandboxRoot, requireRemoteServiceConfig(), notifySearchConsole)))
cmsApp.route('/', cmsPreviewRoutes)

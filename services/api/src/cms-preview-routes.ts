import { Hono } from 'hono'
import { z } from 'zod'
import { CmsPreviewService } from './cms-preview.js'
import { appConfig } from './config.js'
import { pool } from './db.js'
import { requireAuth, getAuthUser, type AuthVariables } from './auth-middleware.js'
import { resolveSessionFromToken } from './sessions.js'

export const cmsPreviews = new CmsPreviewService(pool, appConfig.sandboxRoot, appConfig.previewRoot, appConfig.previewCredentialTtlSeconds)
export const cmsPreviewRoutes = new Hono<{ Variables: AuthVariables }>()
const inputSchema = z.object({
  locale: z.string().optional(),
  returnPath: z.string().optional(),
  target: z.object({ ref: z.enum(['page', 'collection', 'group', 'item']), id: z.string().min(1) }).strict().optional(),
}).strict()

cmsPreviewRoutes.post('/api/drafts/:draftId/preview', requireAuth, async c => {
  const input = inputSchema.safeParse(await c.req.json())
  if (!input.success) return c.json({ code: 'VALIDATION_FAILED', error: '预览参数无效' }, 400)
  const session = await resolveSessionFromToken(c.get('accessToken'))
  if (!session) return c.json({ code: 'FORBIDDEN', error: '会话已失效' }, 403)
  try {
    return c.json(await cmsPreviews.create(getAuthUser(c).userId, session.sessionId, c.req.param('draftId')!, input.data))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'PREVIEW_FORBIDDEN') return c.json({ code: 'FORBIDDEN', error: '无权访问此预览' }, 403)
    if (message === 'DRAFT_NOT_READY') return c.json({ code: 'DRAFT_NOT_READY', error: '网站尚未完成初始化' }, 409)
    if (['PREVIEW_LOCALE_INVALID', 'PREVIEW_RETURN_PATH_INVALID', 'PREVIEW_NOT_FOUND'].includes(message)) return c.json({ code: message, error: '预览目标或返回地址无效' }, 400)
    throw error
  }
})

cmsPreviewRoutes.get('/preview-access/:token/*', async c => {
  try {
    const prefix = `/preview-access/${c.req.param('token')}/`
    const file = await cmsPreviews.read(c.req.param('token'), c.req.path.slice(prefix.length))
    return new Response(new Uint8Array(file.content), { headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-top-navigation-by-user-activation',
    } })
  } catch (error) {
    if (error instanceof Error && error.message === 'PREVIEW_FORBIDDEN') return c.text('预览已失效或访问权限已取消', 403)
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return c.text('页面不存在', 404)
    if (error instanceof URIError) return c.text('地址无效', 400)
    throw error
  }
})

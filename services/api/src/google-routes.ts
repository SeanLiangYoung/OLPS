import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { getAuthUser, requireAuth, type AuthVariables } from './auth-middleware.js'
import { resolveSessionFromToken } from './sessions.js'
import { beginGoogleAuthorization, bindGoogleResources, finishGoogleAuthorization, getGoogleStatus, queryGoogleAds, queryGoogleAnalytics, resolveGoogleTarget, revokeGoogleAuthorization } from './google-service.js'

export const googleRoutes = new Hono<{ Variables: AuthVariables }>()
const cookieName = 'olps_google_browser'
const cookiePath = '/api/google/callback'
const resourceSchema = z.object({
  adsAccountId: z.string().trim().regex(/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/).optional(),
  gaPropertyId: z.string().trim().regex(/^\d{1,20}$/).optional(),
}).strict().refine((value) => value.adsAccountId || value.gaPropertyId)

googleRoutes.onError((error, c) => {
  if (error.message === 'FORBIDDEN') return c.json({ error: '无权访问 Google 集成' }, 403)
  if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'Google 请求内容无效' }, 400)
  if (['GOOGLE_STATE_INVALID', 'GOOGLE_SESSION_INVALID', 'GOOGLE_AUTHORIZATION_DENIED', 'GOOGLE_RESOURCE_ID_INVALID', 'GOOGLE_RESOURCE_ID_REQUIRED'].includes(error.message)) {
    return c.json({ error: 'Google 授权或资源信息无效，请重新授权或检查资源 ID' }, 400)
  }
  if (['GOOGLE_AUTHORIZATION_REQUIRED', 'GOOGLE_SCOPE_REQUIRED', 'GOOGLE_OFFLINE_ACCESS_REQUIRED'].includes(error.message)) {
    return c.json({ error: '请完成 Google 授权并授予所需访问权限' }, 409)
  }
  if (error.message.startsWith('GOOGLE_') && /CONFIGURED|ENCRYPTION_KEY|REDIRECT_URI/.test(error.message)) {
    return c.json({ error: '服务端尚未完成 Google 配置' }, 503)
  }
  // Google SDK 的错误对象可能包含请求凭据。
  return c.json({ error: 'Google 请求失败，请检查账户权限、API 配置与授权有效期' }, 502)
})

googleRoutes.get('/api/google/callback', async (c) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  const browserToken = getCookie(c, cookieName) ?? ''
  deleteCookie(c, cookieName, { path: cookiePath })
  await finishGoogleAuthorization(c.req.query('state') ?? '', browserToken, c.req.query('code') ?? '', Boolean(c.req.query('error')))
  return c.redirect('/integrations?google=connected', 303)
})

for (const kind of ['draft', 'site'] as const) {
  const base = `/api/${kind === 'draft' ? 'drafts' : 'sites'}/:targetId/google`
  const targetFor = (c: Context) => resolveGoogleTarget(getAuthUser(c).userId, kind, c.req.param('targetId')!)
  googleRoutes.use(`${base}*`, requireAuth)
  googleRoutes.use(`${base}*`, async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })

  googleRoutes.get(base, async (c) => c.json({ google: await getGoogleStatus(getAuthUser(c).userId, await targetFor(c)) }))
  googleRoutes.post(`${base}/authorize`, async (c) => {
    const session = await resolveSessionFromToken(c.get('accessToken'))
    if (!session) return c.json({ error: '登录会话已经过期' }, 401)
    const result = await beginGoogleAuthorization(session.userId, session.sessionId, await targetFor(c))
    setCookie(c, cookieName, result.browserToken, {
      path: cookiePath, httpOnly: true, secure: new URL(process.env.GOOGLE_REDIRECT_URI!).protocol === 'https:', sameSite: 'Lax', maxAge: 600,
    })
    return c.json({ url: result.url })
  })
  googleRoutes.patch(`${base}/resources`, async (c) => {
    const target = await targetFor(c)
    const resources = resourceSchema.parse(await c.req.json())
    return c.json({ google: await bindGoogleResources(getAuthUser(c).userId, target, resources) })
  })
  googleRoutes.get(`${base}/analytics`, async (c) => c.json({ report: await queryGoogleAnalytics(getAuthUser(c).userId, await targetFor(c)) }))
  googleRoutes.get(`${base}/ads`, async (c) => {
    const pageToken = c.req.query('pageToken')
    if (pageToken && pageToken.length > 8192) return c.json({ error: '分页参数无效' }, 400)
    return c.json({ report: await queryGoogleAds(getAuthUser(c).userId, await targetFor(c), undefined, pageToken) })
  })
  googleRoutes.delete(base, async (c) => {
    await revokeGoogleAuthorization(getAuthUser(c).userId, await targetFor(c))
    return c.json({ disconnected: true })
  })
}

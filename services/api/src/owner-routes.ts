import { Hono } from 'hono'
import { z } from 'zod'
import { getAuthUser, requireAuth, type AuthVariables } from './auth-middleware.js'
import { addDraftOwner, addSiteOwner, listDraftOwners, listSiteOwners, removeDraftOwner, removeSiteOwner } from './collaboration-owners.js'

export const ownerRoutes = new Hono<{ Variables: AuthVariables }>()
const accountSchema = z.object({ account: z.string().trim().min(1) }).strict()
for (const scope of ['site', 'draft'] as const) {
  const prefix = scope === 'site' ? '/sites/:resourceId/owners' : '/drafts/:resourceId/owners'
  const list = scope === 'site' ? listSiteOwners : listDraftOwners
  const add = scope === 'site' ? addSiteOwner : addDraftOwner
  const remove = scope === 'site' ? removeSiteOwner : removeDraftOwner
  const responseError = (error: unknown): { error: string; code: string; status: 400 | 403 | 409 } => {
    if (!(error instanceof Error)) throw error
    if (error.message === 'FORBIDDEN') return { error: '没有管理权限', code: 'FORBIDDEN', status: 403 }
    if (/^LAST_(DRAFT|SITE)_OWNER$/.test(error.message)) return { error: '必须保留至少一名所有者', code: error.message, status: 409 }
    if (error.message.startsWith('用户不存在:')) return { error: error.message, code: 'USER_NOT_FOUND', status: 400 }
    throw error
  }
  ownerRoutes.get(prefix, requireAuth, async c => {
    try { return c.json({ users: await list(getAuthUser(c).userId, c.req.param('resourceId')!) }) }
    catch (error) { const result = responseError(error); return c.json({ error: result.error, code: result.code }, result.status) }
  })
  ownerRoutes.post(prefix, requireAuth, async c => {
    const input = accountSchema.safeParse(await c.req.json())
    if (!input.success) return c.json({ error: '请填写已有用户账号', code: 'VALIDATION_FAILED' }, 400)
    try { await add(getAuthUser(c).userId, c.req.param('resourceId')!, input.data.account); return c.json({ ok: true }) }
    catch (error) { const result = responseError(error); return c.json({ error: result.error, code: result.code }, result.status) }
  })
  ownerRoutes.delete(`${prefix}/:userId`, requireAuth, async c => {
    try { await remove(getAuthUser(c).userId, c.req.param('resourceId')!, c.req.param('userId')!); return c.json({ ok: true }) }
    catch (error) { const result = responseError(error); return c.json({ error: result.error, code: result.code }, result.status) }
  })
}

import type { Hono } from 'hono'
import { getAuthUser, type AuthVariables } from './auth-middleware.js'
import { assertInquiryMailOwner, listInquiryMail } from './mail-service.js'

export function mountMailRoutes(app: Hono<{ Variables: AuthVariables }>): void {
  app.get('/api/inquiries/:inquiryId/emails', async (c) => {
    const inquiryId = Number(c.req.param('inquiryId'))
    if (!Number.isSafeInteger(inquiryId) || inquiryId <= 0) return c.json({ error: '询盘编号无效' }, 400)
    try { await assertInquiryMailOwner(getAuthUser(c).userId, inquiryId) } catch {
      return c.json({ error: '无权访问' }, 403)
    }
    return c.json({ emails: await listInquiryMail(inquiryId), configured: Boolean(process.env.SMTP_HOST?.trim()) })
  })
}

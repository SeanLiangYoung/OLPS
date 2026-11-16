import type { Hono } from 'hono'
import { z } from 'zod'
import { getAuthUser, type AuthVariables } from './auth-middleware.js'
import { createModelReport } from './model-report-service.js'
import { getReportSiteData } from './report-site-data.js'

export function mountModelReportRoutes(app: Hono<{ Variables: AuthVariables }>): void {
  app.get('/api/drafts/:draftId/pages/:pageId/report-data', async (c) => {
    c.header('Cache-Control', 'no-store')
    try {
      return c.json({ data: await getReportSiteData(getAuthUser(c).userId, c.req.param('draftId'), c.req.param('pageId')) })
    } catch (error) {
      if (error instanceof Error && error.message === 'FORBIDDEN') return c.json({ error: '无权访问网站统计' }, 403)
      if (error instanceof Error && error.message === 'NOT_FOUND') return c.json({ error: '页面不存在' }, 404)
      throw error
    }
  })
  app.post('/api/reports/diagnose', async (c) => {
    const input = z.object({ draftId: z.string().min(1), pageId: z.string().min(1), publicUrl: z.string().url().max(2048).optional() }).safeParse(await c.req.json())
    if (!input.success) return c.json({ error: input.error.message }, 400)
    try {
      return c.json({ report: await createModelReport({ ...input.data, userId: getAuthUser(c).userId }) }, 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ error: message }, message === 'FORBIDDEN' ? 403 : 400)
    }
  })
}

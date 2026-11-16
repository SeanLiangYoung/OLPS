import { Hono } from 'hono'
import { z } from 'zod'
import { getAuthUser, requireAuth, type AuthVariables } from './auth-middleware.js'
import { confirmPublication, getPublication, listManagedSites, previewPublication, getPublicationTask, listPublicationTasks, PublicationError, restorePublicationPage } from './selected-publication.js'

export const selectedPublicationRoutes = new Hono<{ Variables: AuthVariables }>()
selectedPublicationRoutes.use('/api/drafts/:draftId/publication*', requireAuth)
selectedPublicationRoutes.use('/api/managed-sites', requireAuth)
selectedPublicationRoutes.onError((error, c) => {
  if (error instanceof PublicationError) return c.json({ error: error.message, issues: error.issues, taskId: error.taskId }, error.status)
  if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: '发布请求内容无效' }, 400)
  throw error
})
selectedPublicationRoutes.get('/api/managed-sites', async (c) => c.json({ sites: await listManagedSites(getAuthUser(c).userId) }))
selectedPublicationRoutes.get('/api/drafts/:draftId/publication', async (c) => c.json(await getPublication(getAuthUser(c).userId, c.req.param('draftId'))))
selectedPublicationRoutes.post('/api/drafts/:draftId/publication/pages/:pageId/restore', async (c) => c.json(await restorePublicationPage(getAuthUser(c).userId, c.req.param('draftId'), c.req.param('pageId'))))
selectedPublicationRoutes.post('/api/drafts/:draftId/publication/preview', async (c) => {
  const input = z.object({ pageIds: z.array(z.string().min(1)).max(1000), includeSettings: z.boolean() }).strict().parse(await c.req.json())
  return c.json(await previewPublication(getAuthUser(c).userId, c.req.param('draftId'), input))
})
selectedPublicationRoutes.post('/api/drafts/:draftId/publication/confirm', async (c) => {
  const input = z.object({ token: z.string().min(1).max(512) }).strict().parse(await c.req.json())
  return c.json(await confirmPublication(getAuthUser(c).userId, c.req.param('draftId'), input.token))
})
selectedPublicationRoutes.get('/api/drafts/:draftId/publication/tasks/:taskId', async (c) => c.json(await getPublicationTask(getAuthUser(c).userId, c.req.param('draftId'), c.req.param('taskId'))))
selectedPublicationRoutes.get('/api/drafts/:draftId/publication/tasks', async (c) => c.json(await listPublicationTasks(getAuthUser(c).userId, c.req.param('draftId'))))

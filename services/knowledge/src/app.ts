import { Hono } from 'hono'
import type { KnowledgeServiceConfig } from './types.js'

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice('Bearer '.length).trim()
}

export function createKnowledgeApp(config: KnowledgeServiceConfig): Hono {
  const app = new Hono()

  app.use('*', async (c, next) => {
    if (extractBearerToken(c.req.header('Authorization')) !== config.serviceToken) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  })

  app.get('/health', (c) => c.json({ status: 'ok' }))

  return app
}
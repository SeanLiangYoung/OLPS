import { Hono } from 'hono'
import {
  ensureKnowledgeProject,
  isKnowledgeProjectInitialized,
  listKnowledgeProjects,
  readProjectSummary,
} from './project-layout.js'
import {
  InvalidProjectPathError,
  ProjectFileNotFoundError,
  listProjectFiles,
  readProjectFileContent,
} from './project-files.js'
import { InvalidSiteIdError, assertLegalSiteId } from './site-id.js'
import type { KnowledgeServiceConfig } from './types.js'

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice('Bearer '.length).trim()
}

function siteIdErrorResponse(c: { json: (body: unknown, status: number) => Response }, siteId: string) {
  try {
    assertLegalSiteId(siteId)
  } catch (err) {
    if (err instanceof InvalidSiteIdError) {
      return c.json({ error: 'invalid_site_id' }, 400)
    }
    throw err
  }
  return null
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

  const apiV1 = new Hono()

  apiV1.get('/projects', async (c) => {
    const projects = await listKnowledgeProjects(config.knowledgeRoot)
    return c.json({ projects })
  })

  apiV1.get('/projects/:siteId', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
    if (!exists) {
      return c.json({ error: 'project_not_found' }, 404)
    }
    const summary = await readProjectSummary(config.knowledgeRoot, siteId)
    return c.json(summary)
  })

  apiV1.post('/projects/:siteId/project', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    const summary = await ensureKnowledgeProject(config.knowledgeRoot, siteId)
    return c.json(summary)
  })

  apiV1.get('/projects/:siteId/files', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
    if (!exists) {
      return c.json({ error: 'project_not_found' }, 404)
    }
    try {
      const files = await listProjectFiles(config.knowledgeRoot, siteId, c.req.query('prefix'))
      return c.json({ files })
    } catch (err) {
      if (err instanceof InvalidProjectPathError) {
        return c.json({ error: 'invalid_path' }, 400)
      }
      throw err
    }
  })

  apiV1.get('/projects/:siteId/files/content', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
    if (!exists) {
      return c.json({ error: 'project_not_found' }, 404)
    }
    const filePath = c.req.query('path')
    if (filePath === undefined || filePath.trim() === '') {
      return c.json({ error: 'invalid_path' }, 400)
    }
    try {
      const body = await readProjectFileContent(config.knowledgeRoot, siteId, filePath)
      return c.json(body)
    } catch (err) {
      if (err instanceof InvalidProjectPathError) {
        return c.json({ error: 'invalid_path' }, 400)
      }
      if (err instanceof ProjectFileNotFoundError) {
        return c.json({ error: 'file_not_found' }, 404)
      }
      throw err
    }
  })

  app.route('/api/v1', apiV1)

  return app
}
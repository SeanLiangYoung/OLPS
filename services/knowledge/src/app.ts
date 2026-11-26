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
import {
  ImportRequestError,
  createKnowledgeImport,
  getImportStatus,
  retryFailedImportItems,
} from './import-service.js'
import type { CreateImportBody } from './import-service.js'
import { ManualDocumentError } from './manual-document.js'
import { handleManualDocumentCopy } from './manual-copy.js'
import { handlePagesWrite } from './pages-write.js'
import {
  KnowledgeProjectionError,
  rebuildKnowledgeProjection,
} from './projection-sync.js'
import {
  AssetsApiError,
  handleGetAssetFile,
  handleListAssets,
  handleListReviews,
  handlePatchAsset,
  handleResolveReview,
} from './assets-api.js'
import { ReviewMutationError } from './project-reviews.js'
import { KnowledgeSearchError, searchKnowledgeProject } from './knowledge-search.js'
import { buildKnowledgeGraph } from './wiki-graph.js'
import {
  bytesReceived,
  completeUploadSession,
  createUploadSession,
  getUploadSession,
  putUploadFileChunk,
  putUploadZipChunk,
  UploadSessionError,
} from './upload-session.js'

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

  apiV1.post('/projects/:siteId/imports/sessions', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    let body: Parameters<typeof createUploadSession>[2]
    try {
      body = (await c.req.json()) as Parameters<typeof createUploadSession>[2]
    } catch {
      return c.json({ error: 'upload_bad_request' }, 400)
    }
    try {
      const session = await createUploadSession(config, siteId, body)
      return c.json(
        {
          uploadId: session.uploadId,
          chunkBytes: session.chunkBytes,
          status: session.status,
          bytesReceived: bytesReceived(session),
          received: session.received,
        },
        201,
      )
    } catch (err) {
      if (err instanceof UploadSessionError) {
        const status =
          err.code === 'project_not_found' || err.code === 'upload_not_found'
            ? 404
            : err.code === 'upload_conflict'
              ? 409
              : 400
        return c.json({ error: err.code }, status)
      }
      throw err
    }
  })

  apiV1.get('/projects/:siteId/imports/sessions/:uploadId', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    try {
      const session = await getUploadSession(config, siteId, c.req.param('uploadId'))
      return c.json({
        ...session,
        bytesReceived: bytesReceived(session),
      })
    } catch (err) {
      if (err instanceof UploadSessionError) {
        const status = err.code === 'upload_not_found' || err.code === 'project_not_found' ? 404 : 400
        return c.json({ error: err.code }, status)
      }
      throw err
    }
  })

  apiV1.put('/projects/:siteId/imports/sessions/:uploadId/chunks/:index', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    const index = Number(c.req.param('index'))
    const bytes = Buffer.from(await c.req.arrayBuffer())
    const chunkSha = c.req.header('x-chunk-sha256') ?? undefined
    try {
      const session = await putUploadZipChunk(config, siteId, c.req.param('uploadId'), index, bytes, chunkSha)
      return c.json({
        uploadId: session.uploadId,
        status: session.status,
        bytesReceived: bytesReceived(session),
        received: session.received,
      })
    } catch (err) {
      if (err instanceof UploadSessionError) {
        const status =
          err.code === 'upload_not_found' || err.code === 'project_not_found'
            ? 404
            : err.code === 'upload_conflict'
              ? 409
              : 400
        return c.json({ error: err.code }, status)
      }
      throw err
    }
  })

  apiV1.put('/projects/:siteId/imports/sessions/:uploadId/files/:fileIndex/chunks/:index', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    const fileIndex = Number(c.req.param('fileIndex'))
    const index = Number(c.req.param('index'))
    const bytes = Buffer.from(await c.req.arrayBuffer())
    const chunkSha = c.req.header('x-chunk-sha256') ?? undefined
    try {
      const session = await putUploadFileChunk(
        config,
        siteId,
        c.req.param('uploadId'),
        fileIndex,
        index,
        bytes,
        chunkSha,
      )
      return c.json({
        uploadId: session.uploadId,
        status: session.status,
        bytesReceived: bytesReceived(session),
        received: session.received,
      })
    } catch (err) {
      if (err instanceof UploadSessionError) {
        const status =
          err.code === 'upload_not_found' || err.code === 'project_not_found'
            ? 404
            : err.code === 'upload_conflict'
              ? 409
              : 400
        return c.json({ error: err.code }, status)
      }
      throw err
    }
  })

  apiV1.post('/projects/:siteId/imports/sessions/:uploadId/complete', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    try {
      const created = await completeUploadSession(config, siteId, c.req.param('uploadId'))
      return c.json(created, 202)
    } catch (err) {
      if (err instanceof UploadSessionError) {
        const status =
          err.code === 'upload_not_found' || err.code === 'project_not_found'
            ? 404
            : err.code === 'upload_conflict'
              ? 409
              : 400
        return c.json({ error: err.code }, status)
      }
      throw err
    }
  })

  apiV1.post('/projects/:siteId/imports', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    let body: CreateImportBody
    try {
      body = (await c.req.json()) as CreateImportBody
    } catch {
      return c.json({ error: 'import_bad_request' }, 400)
    }
    try {
      const created = await createKnowledgeImport(config, siteId, body)
      return c.json(created, 202)
    } catch (err) {
      if (err instanceof ImportRequestError) {
        const status = err.code === 'project_not_found' ? 404 : 400
        return c.json({ error: err.code }, status)
      }
      throw err
    }
  })

  apiV1.get('/projects/:siteId/imports/:importId', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    const importId = c.req.param('importId')
    try {
      const status = await getImportStatus(config.knowledgeRoot, siteId, importId)
      return c.json(status)
    } catch (err) {
      if (err instanceof ImportRequestError) {
        const code = err.code
        const status = code === 'project_not_found' || code === 'import_not_found' ? 404 : 400
        return c.json({ error: code }, status)
      }
      throw err
    }
  })

  apiV1.post('/projects/:siteId/imports/:importId/retry', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    const importId = c.req.param('importId')
    let body: { sourcePaths?: string[] } = {}
    const contentType = c.req.header('content-type') ?? ''
    if (contentType.includes('application/json')) {
      try {
        body = (await c.req.json()) as { sourcePaths?: string[] }
      } catch {
        return c.json({ error: 'import_bad_request' }, 400)
      }
    }
    try {
      const result = await retryFailedImportItems(config, siteId, importId, body)
      return c.json(result, 202)
    } catch (err) {
      if (err instanceof ImportRequestError) {
        const code = err.code
        const status =
          code === 'project_not_found' || code === 'import_not_found'
            ? 404
            : code === 'import_not_retryable'
              ? 409
              : 400
        return c.json({ error: code }, status)
      }
      throw err
    }
  })

  apiV1.post('/projects/:siteId/pages/write', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    if (!config.databaseUrl) {
      return c.json({ error: 'projection_not_configured' }, 503)
    }
    const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
    if (!exists) {
      return c.json({ error: 'project_not_found' }, 404)
    }
    let body: Parameters<typeof handlePagesWrite>[2]
    try {
      body = (await c.req.json()) as Parameters<typeof handlePagesWrite>[2]
    } catch {
      return c.json({ error: 'pages_write_bad_request' }, 400)
    }
    try {
      const result = await handlePagesWrite(config, siteId, body)
      return c.json(result)
    } catch (err) {
      if (err instanceof ManualDocumentError) {
        const status =
          err.code === 'project_not_found' || err.code === 'document_not_found'
            ? 404
            : err.code === 'document_exists'
              ? 409
              : 400
        return c.json({ error: err.code }, status)
      }
      throw err
    }
  })

  apiV1.post('/projects/:siteId/manual-documents/:documentId/copy', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    if (!config.databaseUrl) {
      return c.json({ error: 'projection_not_configured' }, 503)
    }
    const sourceExists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
    if (!sourceExists) {
      return c.json({ error: 'project_not_found' }, 404)
    }
    let body: { targetSiteId?: string; newDocumentId?: string }
    try {
      body = (await c.req.json()) as { targetSiteId?: string; newDocumentId?: string }
    } catch {
      return c.json({ error: 'manual_copy_bad_request' }, 400)
    }
    try {
      const result = await handleManualDocumentCopy(
        config,
        siteId,
        c.req.param('documentId'),
        { targetSiteId: body.targetSiteId ?? '', newDocumentId: body.newDocumentId ?? '' },
      )
      return c.json(result, 201)
    } catch (err) {
      if (err instanceof ManualDocumentError) {
        const status =
          err.code === 'project_not_found' || err.code === 'document_not_found'
            ? 404
            : err.code === 'document_exists'
              ? 409
              : 400
        return c.json({ error: err.code }, status)
      }
      throw err
    }
  })

  apiV1.post('/projects/:siteId/projection/rebuild', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    if (!config.databaseUrl) {
      return c.json({ error: 'projection_not_configured' }, 503)
    }
    const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
    if (!exists) {
      return c.json({ error: 'project_not_found' }, 404)
    }
    let body: { importId?: string } = {}
    try {
      const raw = await c.req.text()
      if (raw.trim()) {
        body = JSON.parse(raw) as { importId?: string }
      }
    } catch {
      return c.json({ error: 'projection_bad_request' }, 400)
    }
    try {
      const summary = await rebuildKnowledgeProjection({
        knowledgeRoot: config.knowledgeRoot,
        databaseUrl: config.databaseUrl,
        siteId,
        importId: body.importId?.trim() || null,
      })
      return c.json(summary)
    } catch (err) {
      if (err instanceof KnowledgeProjectionError) {
        const status = err.code === 'kb_not_found' || err.code === 'import_not_found' ? 404 : 503
        return c.json({ error: err.code }, status)
      }
      throw err
    }
  })

  apiV1.post('/projects/:siteId/search', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
    if (!exists) {
      return c.json({ error: 'project_not_found' }, 404)
    }
    let body: Parameters<typeof searchKnowledgeProject>[2]
    try {
      body = (await c.req.json()) as Parameters<typeof searchKnowledgeProject>[2]
    } catch {
      return c.json({ error: 'search_bad_request' }, 400)
    }
    try {
      const result = await searchKnowledgeProject(config.knowledgeRoot, siteId, body)
      return c.json(result)
    } catch (err) {
      if (err instanceof KnowledgeSearchError) {
        return c.json({ error: err.code }, 400)
      }
      throw err
    }
  })

  apiV1.get('/projects/:siteId/graph', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
    if (!exists) {
      return c.json({ error: 'project_not_found' }, 404)
    }
    const graph = await buildKnowledgeGraph(config.knowledgeRoot, siteId)
    return c.json(graph)
  })

  apiV1.get('/projects/:siteId/assets', async (c) => {
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
      const body = await handleListAssets(config.knowledgeRoot, siteId, c.req.query('role'))
      return c.json(body)
    } catch (err) {
      if (err instanceof AssetsApiError) {
        return c.json({ error: err.code }, 400)
      }
      throw err
    }
  })

  apiV1.get('/projects/:siteId/reviews', async (c) => {
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
      const body = await handleListReviews(config.knowledgeRoot, siteId, c.req.query('status'))
      return c.json(body)
    } catch (err) {
      if (err instanceof AssetsApiError) {
        return c.json({ error: err.code }, 400)
      }
      throw err
    }
  })

  apiV1.post('/projects/:siteId/reviews/:id/resolve', async (c) => {
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
      const body = await handleResolveReview(config.knowledgeRoot, siteId, c.req.param('id'))
      return c.json(body)
    } catch (err) {
      if (err instanceof ReviewMutationError) {
        const status = err.code === 'review_not_found' ? 404 : 409
        return c.json({ error: err.code }, status)
      }
      throw err
    }
  })

  apiV1.patch('/projects/:siteId/assets/:assetId', async (c) => {
    const siteId = c.req.param('siteId')
    const invalid = siteIdErrorResponse(c, siteId)
    if (invalid) {
      return invalid
    }
    const exists = await isKnowledgeProjectInitialized(config.knowledgeRoot, siteId)
    if (!exists) {
      return c.json({ error: 'project_not_found' }, 404)
    }
    let body: Parameters<typeof handlePatchAsset>[3]
    try {
      body = (await c.req.json()) as Parameters<typeof handlePatchAsset>[3]
    } catch {
      return c.json({ error: 'asset_patch_bad_request' }, 400)
    }
    try {
      const result = await handlePatchAsset(config, siteId, c.req.param('assetId'), body)
      return c.json(result)
    } catch (err) {
      if (err instanceof AssetsApiError) {
        const status = err.code === 'asset_not_found' ? 404 : 400
        return c.json({ error: err.code }, status)
      }
      if (err instanceof KnowledgeProjectionError) {
        const status = err.code === 'kb_not_found' ? 404 : 503
        return c.json({ error: err.code }, status)
      }
      throw err
    }
  })

  apiV1.get('/projects/:siteId/assets/:assetId/file', async (c) => {
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
      const file = await handleGetAssetFile(config.knowledgeRoot, siteId, c.req.param('assetId'))
      // MCP SDK 引入的 DOM/Fetch 类型下，Node Buffer 不能直接作为 BodyInit
      return new Response(Uint8Array.from(file.bytes), {
        status: 200,
        headers: {
          'Content-Type': file.mime,
          'Content-Length': String(file.bytes.length),
          'Content-Disposition': `inline; filename="${file.fileName.replaceAll('"', '')}"`,
        },
      })
    } catch (err) {
      if (err instanceof AssetsApiError) {
        const status = err.code === 'asset_not_found' || err.code === 'asset_file_missing' ? 404 : 400
        return c.json({ error: err.code }, status)
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
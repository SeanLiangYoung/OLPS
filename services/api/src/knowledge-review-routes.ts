import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from './db.js'
import { getAuthUser, requireAuth, type AuthVariables } from './auth-middleware.js'
import {
  KnowledgeImportProxyError,
  KnowledgeProjectBootstrapError,
  listKnowledgeAssetsFromService,
  listKnowledgeReviewsFromService,
  patchKnowledgeAssetOnService,
  resolveKnowledgeReviewOnService,
} from './knowledge-service-client.js'

export const knowledgeReviewRoutes = new Hono<{ Variables: AuthVariables }>()

const patchAssetSchema = z
  .object({
    role: z.string().trim().min(1).optional(),
    caption: z.string().optional(),
    roleReason: z.string().optional(),
  })
  .strict()
  .refine((value) => value.role !== undefined || value.caption !== undefined || value.roleReason !== undefined, {
    message: '至少提供 role、caption 或 roleReason 之一',
  })

function mapKnowledgeReviewError(errorCode: string): { message: string; code: string } {
  switch (errorCode) {
    case 'review_not_found':
      return { code: 'REVIEW_NOT_FOUND', message: '找不到该待审项' }
    case 'review_already_resolved':
      return { code: 'REVIEW_ALREADY_RESOLVED', message: '该待审项已经处理过' }
    case 'invalid_role':
      return { code: 'INVALID_ROLE', message: '素材角色无效' }
    case 'invalid_status':
      return { code: 'INVALID_STATUS', message: '待审状态过滤参数无效' }
    case 'asset_not_found':
      return { code: 'ASSET_NOT_FOUND', message: '找不到该素材' }
    case 'asset_patch_bad_request':
      return { code: 'VALIDATION_FAILED', message: '素材修正请求无效' }
    case 'project_not_found':
      return { code: 'KNOWLEDGE_NOT_READY', message: '网站知识库尚未就绪，请稍候再试' }
    case 'kb_not_found':
      return { code: 'NOT_FOUND', message: '知识库不存在' }
    case 'projection_not_configured':
      return { code: 'KNOWLEDGE_UNAVAILABLE', message: '知识库投影未配置' }
    default:
      return { code: 'KNOWLEDGE_FAILED', message: '知识库操作失败' }
  }
}

async function requireKnowledgeBase(siteId: string, userId: string): Promise<Record<string, unknown>> {
  const result = await pool.query(
    'SELECT k.* FROM knowledge_bases k JOIN site_owners o USING(site_id) WHERE k.site_id=$1 AND o.user_id=$2',
    [siteId, userId],
  )
  const record = result.rows[0] as Record<string, unknown> | undefined
  if (!record) {
    throw new KnowledgeImportProxyError(404, 'NOT_FOUND', '知识库不存在')
  }
  return record
}

async function readKnowledgeErrorBody(response: Response): Promise<{ error?: string }> {
  const text = await response.text()
  if (!text.trim()) return {}
  return JSON.parse(text) as { error?: string }
}

knowledgeReviewRoutes.get('/sites/:siteId/knowledge-base/reviews', requireAuth, async (c) => {
  const siteId = c.req.param('siteId')!
  try {
    await requireKnowledgeBase(siteId, getAuthUser(c).userId)
  } catch (err) {
    if (err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: err.code }, err.status as 404)
    }
    throw err
  }

  let knowledgeResponse: Response
  try {
    knowledgeResponse = await listKnowledgeReviewsFromService(siteId, c.req.query('status'))
  } catch (err) {
    if (err instanceof KnowledgeProjectBootstrapError || err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: 'KNOWLEDGE_UNAVAILABLE' }, 503)
    }
    throw err
  }

  if (knowledgeResponse.ok) {
    const payload = (await knowledgeResponse.json()) as { reviews: unknown[] }
    return c.json(payload)
  }

  const errorBody = await readKnowledgeErrorBody(knowledgeResponse)
  const mapped = mapKnowledgeReviewError(errorBody.error ?? 'knowledge_failed')
  const status = knowledgeResponse.status === 404 ? 404 : 400
  return c.json({ error: mapped.message, code: mapped.code }, status)
})

knowledgeReviewRoutes.post('/sites/:siteId/knowledge-base/reviews/:reviewId/resolve', requireAuth, async (c) => {
  const siteId = c.req.param('siteId')!
  try {
    await requireKnowledgeBase(siteId, getAuthUser(c).userId)
  } catch (err) {
    if (err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: err.code }, err.status as 404)
    }
    throw err
  }

  let knowledgeResponse: Response
  try {
    knowledgeResponse = await resolveKnowledgeReviewOnService(siteId, c.req.param('reviewId')!)
  } catch (err) {
    if (err instanceof KnowledgeProjectBootstrapError || err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: 'KNOWLEDGE_UNAVAILABLE' }, 503)
    }
    throw err
  }

  if (knowledgeResponse.ok) {
    const payload = (await knowledgeResponse.json()) as { review: Record<string, unknown> }
    return c.json(payload)
  }

  const errorBody = await readKnowledgeErrorBody(knowledgeResponse)
  const mapped = mapKnowledgeReviewError(errorBody.error ?? 'knowledge_failed')
  const status =
    knowledgeResponse.status === 404 ? 404 : knowledgeResponse.status === 409 ? 409 : 400
  return c.json({ error: mapped.message, code: mapped.code }, status)
})

knowledgeReviewRoutes.get('/sites/:siteId/knowledge-base/assets', requireAuth, async (c) => {
  const siteId = c.req.param('siteId')!
  try {
    await requireKnowledgeBase(siteId, getAuthUser(c).userId)
  } catch (err) {
    if (err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: err.code }, err.status as 404)
    }
    throw err
  }

  let knowledgeResponse: Response
  try {
    knowledgeResponse = await listKnowledgeAssetsFromService(siteId, c.req.query('role'))
  } catch (err) {
    if (err instanceof KnowledgeProjectBootstrapError || err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: 'KNOWLEDGE_UNAVAILABLE' }, 503)
    }
    throw err
  }

  if (knowledgeResponse.ok) {
    const payload = (await knowledgeResponse.json()) as { assets: unknown[] }
    return c.json(payload)
  }

  const errorBody = await readKnowledgeErrorBody(knowledgeResponse)
  const mapped = mapKnowledgeReviewError(errorBody.error ?? 'knowledge_failed')
  const status = knowledgeResponse.status === 404 ? 404 : 400
  return c.json({ error: mapped.message, code: mapped.code }, status)
})

knowledgeReviewRoutes.patch('/sites/:siteId/knowledge-base/assets/:assetId', requireAuth, async (c) => {
  const siteId = c.req.param('siteId')!
  try {
    await requireKnowledgeBase(siteId, getAuthUser(c).userId)
  } catch (err) {
    if (err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: err.code }, err.status as 404)
    }
    throw err
  }

  const parsed = patchAssetSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: '素材修正参数无效', code: 'VALIDATION_FAILED', details: parsed.error.issues }, 400)
  }

  let knowledgeResponse: Response
  try {
    knowledgeResponse = await patchKnowledgeAssetOnService(siteId, c.req.param('assetId')!, parsed.data)
  } catch (err) {
    if (err instanceof KnowledgeProjectBootstrapError || err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: 'KNOWLEDGE_UNAVAILABLE' }, 503)
    }
    throw err
  }

  if (knowledgeResponse.ok) {
    const payload = (await knowledgeResponse.json()) as { asset: Record<string, unknown> }
    return c.json(payload)
  }

  const errorBody = await readKnowledgeErrorBody(knowledgeResponse)
  const mapped = mapKnowledgeReviewError(errorBody.error ?? 'knowledge_failed')
  const status = knowledgeResponse.status === 404 ? 404 : 400
  return c.json({ error: mapped.message, code: mapped.code }, status)
})

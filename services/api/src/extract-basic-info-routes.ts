import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, type AuthVariables } from './auth-middleware.js'
import {
  applyBasicInfo,
  basicInfoSnapshotSchema,
  extractBasicInfo,
} from './extract-basic-info.js'
import { SchemaValidationError } from '@olps/domain'
import { KnowledgeImportProxyError } from './knowledge-service-client.js'
import { managedResourceContext, resourceErrorResponse } from './managed-resource-context.js'

export const extractBasicInfoRoutes = new Hono<{ Variables: AuthVariables }>()

const extractBodySchema = z.object({
  locale: z.string().min(1),
  knowledgeDocumentIds: z.array(z.string().uuid()).optional(),
}).strict()

const applyBodySchema = z.object({
  locale: z.string().min(1),
  after: basicInfoSnapshotSchema,
  revisions: z.object({
    settings: z.string().min(1),
    plugins: z.string().min(1),
  }).strict(),
}).strict()

function extractRouteError(error: unknown, c: Parameters<typeof resourceErrorResponse>[1]) {
  if (error instanceof z.ZodError) {
    return c.json({ error: '请求或提取结果结构无效', code: 'VALIDATION_FAILED', details: { issues: error.issues } }, 400)
  }
  if (error instanceof KnowledgeImportProxyError) {
    return c.json(
      { error: error.message, code: error.code },
      error.status === 503 ? 503 : error.status === 404 ? 404 : 502,
    )
  }
  if (error instanceof SchemaValidationError) {
    const first = error.errors[0]
    const detail = first ? `${first.objectPath}: ${first.message}` : error.message
    return c.json({ error: `网站设置未通过校验：${detail}`, code: 'VALIDATION_FAILED', details: error.errors }, 400)
  }
  if (error instanceof Error && error.message.includes('缺少环境变量 AI_API_KEY')) {
    return c.json({ error: error.message, code: 'AI_NOT_CONFIGURED' }, 503)
  }
  if (error instanceof Error && (error.message.startsWith('AI ') || error.message.includes('AI 输出') || error.message.includes('AI 返回'))) {
    return c.json({ error: error.message, code: 'AI_FAILED' }, 502)
  }
  return resourceErrorResponse(error, c)
}

extractBasicInfoRoutes.post('/drafts/:draftId/extract-basic-info', requireAuth, async (c) => {
  try {
    const body = extractBodySchema.parse(await c.req.json())
    const context = await managedResourceContext(c)
    const result = await extractBasicInfo(context, body)
    return c.json(result)
  } catch (error) {
    return extractRouteError(error, c)
  }
})

extractBasicInfoRoutes.post('/drafts/:draftId/apply-basic-info', requireAuth, async (c) => {
  try {
    const body = applyBodySchema.parse(await c.req.json())
    const context = await managedResourceContext(c)
    const result = await applyBasicInfo(context, body)
    return c.json(result)
  } catch (error) {
    return extractRouteError(error, c)
  }
})

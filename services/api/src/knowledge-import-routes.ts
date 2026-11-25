import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { pool } from './db.js'
import { getAuthUser, requireAuth, type AuthVariables } from './auth-middleware.js'
import {
  completeKnowledgeUploadSessionOnService,
  createKnowledgeImportOnService,
  createKnowledgeUploadSessionOnService,
  getKnowledgeImportStatusFromService,
  getKnowledgeUploadSessionFromService,
  KnowledgeImportProxyError,
  KnowledgeProjectBootstrapError,
  putKnowledgeUploadFileChunkOnService,
  putKnowledgeUploadZipChunkOnService,
  type KnowledgeImportCreateBody,
  type KnowledgeUploadSessionCreateBody,
} from './knowledge-service-client.js'

/** 与 knowledge 服务默认一致：单次合计 16GB */
const DEFAULT_IMPORT_MAX_BYTES = 16 * 1024 * 1024 * 1024
/** 单文件默认 2GB */
const DEFAULT_SINGLE_FILE_MAX_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

const importBodySchema = z
  .object({
    sourceName: z.string().trim().min(1).max(500).optional(),
    draftId: z.string().uuid().optional(),
    zipBase64: z.string().optional(),
    files: z
      .array(
        z.object({
          relativePath: z.string().trim().min(1),
          contentBase64: z.string().min(1),
        }),
      )
      .optional(),
  })
  .strict()

const uploadSessionBodySchema = z
  .object({
    sourceName: z.string().trim().min(1).max(500).optional(),
    draftId: z.string().uuid().optional(),
    kind: z.enum(['zip', 'files']),
    totalBytes: z.number().int().positive(),
    chunkBytes: z.number().int().positive().optional(),
    sha256: z.string().trim().min(1).optional(),
    files: z
      .array(
        z.object({
          relativePath: z.string().trim().min(1),
          size: z.number().int().positive(),
        }),
      )
      .optional(),
  })
  .strict()

export const knowledgeImportRoutes = new Hono<{ Variables: AuthVariables }>()

function readImportMaxBytes(): number {
  const raw = process.env.KNOWLEDGE_IMPORT_MAX_BYTES?.trim()
  if (!raw) return DEFAULT_IMPORT_MAX_BYTES
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_IMPORT_MAX_BYTES
  return value
}

function readSingleFileMaxBytes(): number {
  const dedicated = process.env.KNOWLEDGE_IMPORT_FILE_MAX_BYTES?.trim()
  if (dedicated) {
    const value = Number(dedicated)
    if (Number.isFinite(value) && value > 0) return value
  }
  return DEFAULT_SINGLE_FILE_MAX_BYTES
}

function readUploadChunkBytes(): number {
  const raw = process.env.KNOWLEDGE_UPLOAD_CHUNK_BYTES?.trim()
  if (!raw) return DEFAULT_UPLOAD_CHUNK_BYTES
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_UPLOAD_CHUNK_BYTES
  return value
}

function formatBytesLimit(bytes: number): string {
  const gib = 1024 * 1024 * 1024
  const mib = 1024 * 1024
  if (bytes % gib === 0) return `${bytes / gib}GB`
  if (bytes % mib === 0) return `${bytes / mib}MB`
  return `${Math.round(bytes / mib)}MB`
}

function knowledgeImportErrorMessage(errorCode: string): { message: string; code: string } {
  const importMax = formatBytesLimit(readImportMaxBytes())
  const fileMax = formatBytesLimit(readSingleFileMaxBytes())
  switch (errorCode) {
    case 'import_total_size_exceeded':
      return {
        code: 'IMPORT_TOTAL_SIZE_EXCEEDED',
        message: `资料包合计体积超过单次上限（${importMax}）`,
      }
    case 'import_file_size_exceeded':
      return { code: 'IMPORT_FILE_SIZE_EXCEEDED', message: `单个文件体积超过上限（${fileMax}）` }
    case 'import_invalid_zip':
      return { code: 'IMPORT_INVALID_ZIP', message: '无法读取压缩包，请确认文件为有效的 zip 格式' }
    case 'import_empty_package':
      return { code: 'IMPORT_EMPTY_PACKAGE', message: '资料包为空，请至少包含一个文件' }
    case 'import_invalid_path':
      return { code: 'IMPORT_INVALID_PATH', message: '资料包中含有非法路径，请去掉「..」或绝对路径后重试' }
    case 'import_bad_request':
      return { code: 'IMPORT_BAD_REQUEST', message: '导入请求无效，请重新选择文件' }
    case 'project_not_found':
      return { code: 'KNOWLEDGE_NOT_READY', message: '网站知识库尚未就绪，请稍候再试' }
    case 'import_not_found':
      return { code: 'NOT_FOUND', message: '找不到该导入任务' }
    case 'upload_bad_request':
      return { code: 'UPLOAD_BAD_REQUEST', message: '上传请求无效，请重新选择文件后重试' }
    case 'upload_not_found':
      return { code: 'UPLOAD_NOT_FOUND', message: '找不到该上传会话，请重新开始上传' }
    case 'upload_conflict':
      return { code: 'UPLOAD_CONFLICT', message: '上传会话状态冲突，请刷新后重试' }
    case 'upload_incomplete':
      return { code: 'UPLOAD_INCOMPLETE', message: '仍有分片未传完，请继续上传后再完成' }
    default:
      return { code: 'IMPORT_FAILED', message: '资料包导入失败' }
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

async function assertDraftOnSite(draftId: string, siteId: string, userId: string): Promise<void> {
  const result = await pool.query(
    `SELECT 1 FROM site_drafts d
     JOIN draft_owners o ON o.draft_id=d.draft_id
     JOIN site_owners so ON so.site_id=d.site_id AND so.user_id=o.user_id
     WHERE d.draft_id=$1 AND d.site_id=$2 AND o.user_id=$3`,
    [draftId, siteId, userId],
  )
  if (!result.rowCount) {
    throw new KnowledgeImportProxyError(403, 'FORBIDDEN', '没有当前编辑版本的访问权限')
  }
}

function validatePackageShape(body: KnowledgeImportCreateBody): void {
  const hasZip = typeof body.zipBase64 === 'string' && body.zipBase64.trim() !== ''
  const hasFiles = Array.isArray(body.files) && body.files.length > 0
  if (hasZip === hasFiles) {
    throw new KnowledgeImportProxyError(400, 'IMPORT_BAD_REQUEST', '请上传 zip 压缩包，或选择整个文件夹，二者选其一')
  }
}

async function readKnowledgeErrorBody(response: Response): Promise<{ error?: string }> {
  const text = await response.text()
  if (!text.trim()) return {}
  return JSON.parse(text) as { error?: string }
}

function unavailableJson(c: { json: (body: unknown, status: 503) => Response }, err: unknown): Response {
  const message =
    err instanceof Error ? err.message : '知识库服务不可达'
  return c.json({ error: message, code: 'KNOWLEDGE_UNAVAILABLE' }, 503)
}

function proxyErrorStatus(knowledgeStatus: number): 400 | 404 | 409 {
  if (knowledgeStatus === 404) return 404
  if (knowledgeStatus === 409) return 409
  return 400
}

knowledgeImportRoutes.post('/sites/:siteId/knowledge-base/imports', requireAuth, async (c) => {
  const siteId = c.req.param('siteId')!
  try {
    await requireKnowledgeBase(siteId, getAuthUser(c).userId)
  } catch (err) {
    if (err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: err.code }, err.status as 404)
    }
    throw err
  }

  const parsed = importBodySchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: '导入参数无效', code: 'VALIDATION_FAILED', details: parsed.error.issues }, 400)
  }

  try {
    validatePackageShape(parsed.data)
    if (parsed.data.draftId) {
      await assertDraftOnSite(parsed.data.draftId, siteId, getAuthUser(c).userId)
    }
  } catch (err) {
    if (err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: err.code }, err.status as 400 | 403)
    }
    throw err
  }

  let knowledgeResponse: Response
  try {
    knowledgeResponse = await createKnowledgeImportOnService(siteId, parsed.data)
  } catch (err) {
    if (err instanceof KnowledgeProjectBootstrapError || err instanceof KnowledgeImportProxyError) {
      return unavailableJson(c, err)
    }
    throw err
  }

  if (knowledgeResponse.status === 202) {
    const payload = (await knowledgeResponse.json()) as { importId: string; status: string }
    return c.json(payload, 202)
  }

  const errorBody = await readKnowledgeErrorBody(knowledgeResponse)
  const mapped = knowledgeImportErrorMessage(errorBody.error ?? 'import_failed')
  const status = knowledgeResponse.status === 404 ? 404 : 400
  return c.json({ error: mapped.message, code: mapped.code }, status)
})

knowledgeImportRoutes.get('/sites/:siteId/knowledge-base/imports/:importId', requireAuth, async (c) => {
  const siteId = c.req.param('siteId')!
  try {
    await requireKnowledgeBase(siteId, getAuthUser(c).userId)
  } catch (err) {
    if (err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: err.code }, err.status as 404)
    }
    throw err
  }

  const importId = c.req.param('importId')!
  let knowledgeResponse: Response
  try {
    knowledgeResponse = await getKnowledgeImportStatusFromService(siteId, importId)
  } catch (err) {
    if (err instanceof KnowledgeProjectBootstrapError || err instanceof KnowledgeImportProxyError) {
      return unavailableJson(c, err)
    }
    throw err
  }

  if (knowledgeResponse.ok) {
    const record = (await knowledgeResponse.json()) as Record<string, unknown>
    return c.json({ import: record })
  }

  const errorBody = await readKnowledgeErrorBody(knowledgeResponse)
  const mapped = knowledgeImportErrorMessage(errorBody.error ?? 'import_not_found')
  const status = knowledgeResponse.status === 404 ? 404 : 400
  return c.json({ error: mapped.message, code: mapped.code }, status)
})

knowledgeImportRoutes.post('/sites/:siteId/knowledge-base/imports/sessions', requireAuth, async (c) => {
  const siteId = c.req.param('siteId')!
  try {
    await requireKnowledgeBase(siteId, getAuthUser(c).userId)
  } catch (err) {
    if (err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: err.code }, err.status as 404)
    }
    throw err
  }

  const parsed = uploadSessionBodySchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: '上传会话参数无效', code: 'VALIDATION_FAILED', details: parsed.error.issues }, 400)
  }

  const body = parsed.data as KnowledgeUploadSessionCreateBody
  if (body.kind === 'files') {
    if (!body.files?.length) {
      return c.json({ error: '文件夹上传须提供 files 清单', code: 'VALIDATION_FAILED' }, 400)
    }
  } else if (body.files?.length) {
    return c.json({ error: 'zip 上传不要附带 files 清单', code: 'VALIDATION_FAILED' }, 400)
  }

  try {
    if (body.draftId) {
      await assertDraftOnSite(body.draftId, siteId, getAuthUser(c).userId)
    }
  } catch (err) {
    if (err instanceof KnowledgeImportProxyError) {
      return c.json({ error: err.message, code: err.code }, err.status as 400 | 403)
    }
    throw err
  }

  let knowledgeResponse: Response
  try {
    knowledgeResponse = await createKnowledgeUploadSessionOnService(siteId, body)
  } catch (err) {
    if (err instanceof KnowledgeProjectBootstrapError || err instanceof KnowledgeImportProxyError) {
      return unavailableJson(c, err)
    }
    throw err
  }

  if (knowledgeResponse.status === 201) {
    return c.json(await knowledgeResponse.json(), 201)
  }

  const errorBody = await readKnowledgeErrorBody(knowledgeResponse)
  const mapped = knowledgeImportErrorMessage(errorBody.error ?? 'upload_bad_request')
  const status = knowledgeResponse.status === 404 ? 404 : 400
  return c.json({ error: mapped.message, code: mapped.code }, status)
})

knowledgeImportRoutes.get(
  '/sites/:siteId/knowledge-base/imports/sessions/:uploadId',
  requireAuth,
  async (c) => {
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
      knowledgeResponse = await getKnowledgeUploadSessionFromService(siteId, c.req.param('uploadId')!)
    } catch (err) {
      if (err instanceof KnowledgeProjectBootstrapError || err instanceof KnowledgeImportProxyError) {
        return unavailableJson(c, err)
      }
      throw err
    }

    if (knowledgeResponse.ok) {
      return c.json(await knowledgeResponse.json())
    }

    const errorBody = await readKnowledgeErrorBody(knowledgeResponse)
    const mapped = knowledgeImportErrorMessage(errorBody.error ?? 'upload_not_found')
    const status = knowledgeResponse.status === 404 ? 404 : 400
    return c.json({ error: mapped.message, code: mapped.code }, status)
  },
)

const chunkMaxBytes = readUploadChunkBytes() * 2 + 64 * 1024
const chunkBodyLimit = bodyLimit({
  maxSize: chunkMaxBytes,
  onError: (c) => c.json({ error: '分片体积超过上限', code: 'UPLOAD_CHUNK_TOO_LARGE' }, 400),
})

knowledgeImportRoutes.put(
  '/sites/:siteId/knowledge-base/imports/sessions/:uploadId/chunks/:index',
  requireAuth,
  chunkBodyLimit,
  async (c) => {
    const siteId = c.req.param('siteId')!
    try {
      await requireKnowledgeBase(siteId, getAuthUser(c).userId)
    } catch (err) {
      if (err instanceof KnowledgeImportProxyError) {
        return c.json({ error: err.message, code: err.code }, err.status as 404)
      }
      throw err
    }

    const index = Number(c.req.param('index'))
    if (!Number.isInteger(index) || index < 0) {
      return c.json({ error: '分片序号无效', code: 'VALIDATION_FAILED' }, 400)
    }
    const bytes = Buffer.from(await c.req.arrayBuffer())
    const chunkSha = c.req.header('x-chunk-sha256') ?? undefined

    let knowledgeResponse: Response
    try {
      knowledgeResponse = await putKnowledgeUploadZipChunkOnService(
        siteId,
        c.req.param('uploadId')!,
        index,
        bytes,
        chunkSha,
      )
    } catch (err) {
      if (err instanceof KnowledgeProjectBootstrapError || err instanceof KnowledgeImportProxyError) {
        return unavailableJson(c, err)
      }
      throw err
    }

    if (knowledgeResponse.ok) {
      return c.json(await knowledgeResponse.json())
    }

    const errorBody = await readKnowledgeErrorBody(knowledgeResponse)
    const mapped = knowledgeImportErrorMessage(errorBody.error ?? 'upload_bad_request')
    return c.json({ error: mapped.message, code: mapped.code }, proxyErrorStatus(knowledgeResponse.status))
  },
)

knowledgeImportRoutes.put(
  '/sites/:siteId/knowledge-base/imports/sessions/:uploadId/files/:fileIndex/chunks/:index',
  requireAuth,
  chunkBodyLimit,
  async (c) => {
    const siteId = c.req.param('siteId')!
    try {
      await requireKnowledgeBase(siteId, getAuthUser(c).userId)
    } catch (err) {
      if (err instanceof KnowledgeImportProxyError) {
        return c.json({ error: err.message, code: err.code }, err.status as 404)
      }
      throw err
    }

    const fileIndex = Number(c.req.param('fileIndex'))
    const index = Number(c.req.param('index'))
    if (!Number.isInteger(fileIndex) || fileIndex < 0 || !Number.isInteger(index) || index < 0) {
      return c.json({ error: '分片序号无效', code: 'VALIDATION_FAILED' }, 400)
    }
    const bytes = Buffer.from(await c.req.arrayBuffer())
    const chunkSha = c.req.header('x-chunk-sha256') ?? undefined

    let knowledgeResponse: Response
    try {
      knowledgeResponse = await putKnowledgeUploadFileChunkOnService(
        siteId,
        c.req.param('uploadId')!,
        fileIndex,
        index,
        bytes,
        chunkSha,
      )
    } catch (err) {
      if (err instanceof KnowledgeProjectBootstrapError || err instanceof KnowledgeImportProxyError) {
        return unavailableJson(c, err)
      }
      throw err
    }

    if (knowledgeResponse.ok) {
      return c.json(await knowledgeResponse.json())
    }

    const errorBody = await readKnowledgeErrorBody(knowledgeResponse)
    const mapped = knowledgeImportErrorMessage(errorBody.error ?? 'upload_bad_request')
    return c.json({ error: mapped.message, code: mapped.code }, proxyErrorStatus(knowledgeResponse.status))
  },
)

knowledgeImportRoutes.post(
  '/sites/:siteId/knowledge-base/imports/sessions/:uploadId/complete',
  requireAuth,
  async (c) => {
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
      knowledgeResponse = await completeKnowledgeUploadSessionOnService(siteId, c.req.param('uploadId')!)
    } catch (err) {
      if (err instanceof KnowledgeProjectBootstrapError || err instanceof KnowledgeImportProxyError) {
        return unavailableJson(c, err)
      }
      throw err
    }

    if (knowledgeResponse.status === 202) {
      return c.json(await knowledgeResponse.json(), 202)
    }

    const errorBody = await readKnowledgeErrorBody(knowledgeResponse)
    const mapped = knowledgeImportErrorMessage(errorBody.error ?? 'upload_bad_request')
    return c.json({ error: mapped.message, code: mapped.code }, proxyErrorStatus(knowledgeResponse.status))
  },
)

import { appConfig } from './config.js'

export class KnowledgeProjectBootstrapError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'KnowledgeProjectBootstrapError'
  }
}

export class KnowledgeDocumentWriteError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'KnowledgeDocumentWriteError'
    this.status = status
    this.code = code
  }
}

export type KnowledgeImportCreateBody = {
  sourceName?: string
  draftId?: string
  zipBase64?: string
  files?: Array<{ relativePath: string; contentBase64: string }>
}

export class KnowledgeImportProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'KnowledgeImportProxyError'
  }
}

function requireKnowledgeServiceConfig(): { baseUrl: string; token: string } {
  const baseUrl = appConfig.knowledgeServiceUrl
  const token = appConfig.knowledgeServiceToken
  if (!baseUrl || !token) {
    throw new KnowledgeProjectBootstrapError('缺少 KNOWLEDGE_SERVICE_URL 或 KNOWLEDGE_SERVICE_TOKEN')
  }
  return { baseUrl, token }
}

async function knowledgeServiceJson(
  pathname: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { baseUrl, token } = requireKnowledgeServiceConfig()
  const url = `${baseUrl}${pathname}`
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    throw new KnowledgeProjectBootstrapError(
      `知识库服务不可达: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  let body: Record<string, unknown> = {}
  const text = await response.text()
  if (text.trim()) {
    body = JSON.parse(text) as Record<string, unknown>
  }
  return { status: response.status, body }
}

async function knowledgeServiceFetch(siteId: string, pathname: string, init?: RequestInit): Promise<Response> {
  const { baseUrl, token } = requireKnowledgeServiceConfig()
  const url = `${baseUrl}/api/v1/projects/${encodeURIComponent(siteId)}${pathname}`
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    throw new KnowledgeImportProxyError(
      503,
      'KNOWLEDGE_UNAVAILABLE',
      `知识库服务不可达: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function ensureKnowledgeProjectForSite(siteId: string): Promise<void> {
  const { status, body } = await knowledgeServiceJson(`/api/v1/projects/${encodeURIComponent(siteId)}/project`, {
    method: 'POST',
  })
  if (status >= 400) {
    throw new KnowledgeProjectBootstrapError(`知识库项目初始化失败 HTTP ${status}: ${JSON.stringify(body)}`)
  }
}

export async function writeKnowledgeManualDocument(input: {
  siteId: string
  action: 'create' | 'update' | 'delete'
  documentId: string
  title?: string
  content?: string
}): Promise<void> {
  const { status, body } = await knowledgeServiceJson(
    `/api/v1/projects/${encodeURIComponent(input.siteId)}/pages/write`,
    {
      method: 'POST',
      body: JSON.stringify({
        action: input.action,
        documentId: input.documentId,
        title: input.title,
        content: input.content,
      }),
    },
  )
  if (status === 200 || status === 201) {
    return
  }
  const code = String(body.error ?? 'knowledge_write_failed')
  throw new KnowledgeDocumentWriteError(status, code, `知识库写入失败 HTTP ${status}: ${code}`)
}

export async function copyKnowledgeManualDocument(input: {
  sourceSiteId: string
  sourceDocumentId: string
  targetSiteId: string
  newDocumentId: string
}): Promise<void> {
  const { status, body } = await knowledgeServiceJson(
    `/api/v1/projects/${encodeURIComponent(input.sourceSiteId)}/manual-documents/${encodeURIComponent(input.sourceDocumentId)}/copy`,
    {
      method: 'POST',
      body: JSON.stringify({
        targetSiteId: input.targetSiteId,
        newDocumentId: input.newDocumentId,
      }),
    },
  )
  if (status === 201) {
    return
  }
  const code = String(body.error ?? 'knowledge_copy_failed')
  throw new KnowledgeDocumentWriteError(status, code, `知识库复制失败 HTTP ${status}: ${code}`)
}

export async function createKnowledgeImportOnService(
  siteId: string,
  body: KnowledgeImportCreateBody,
): Promise<Response> {
  return knowledgeServiceFetch(siteId, '/imports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function getKnowledgeImportStatusFromService(siteId: string, importId: string): Promise<Response> {
  return knowledgeServiceFetch(siteId, `/imports/${encodeURIComponent(importId)}`)
}

export async function listKnowledgeReviewsFromService(
  siteId: string,
  status?: string,
): Promise<Response> {
  const query = status && status.trim() ? `?status=${encodeURIComponent(status.trim())}` : ''
  return knowledgeServiceFetch(siteId, `/reviews${query}`)
}

export async function resolveKnowledgeReviewOnService(siteId: string, reviewId: string): Promise<Response> {
  return knowledgeServiceFetch(siteId, `/reviews/${encodeURIComponent(reviewId)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export async function listKnowledgeAssetsFromService(siteId: string, role?: string): Promise<Response> {
  const query = role && role.trim() ? `?role=${encodeURIComponent(role.trim())}` : ''
  return knowledgeServiceFetch(siteId, `/assets${query}`)
}

export async function patchKnowledgeAssetOnService(
  siteId: string,
  assetId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return knowledgeServiceFetch(siteId, `/assets/${encodeURIComponent(assetId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export type KnowledgeAssetFile = {
  bytes: Buffer
  contentType: string
  fileName: string
}

export async function fetchKnowledgeAssetFileFromService(
  siteId: string,
  assetId: string,
): Promise<KnowledgeAssetFile> {
  const response = await knowledgeServiceFetch(siteId, `/assets/${encodeURIComponent(assetId)}/file`)
  if (response.status === 404) {
    throw new KnowledgeImportProxyError(404, 'ASSET_NOT_FOUND', `知识库素材不存在: ${assetId}`)
  }
  if (!response.ok) {
    const text = await response.text()
    throw new KnowledgeImportProxyError(
      response.status,
      'ASSET_FILE_FAILED',
      `读取知识库素材失败 HTTP ${response.status}: ${text.slice(0, 200)}`,
    )
  }
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  const disposition = response.headers.get('content-disposition') ?? ''
  const matched = /filename="([^"]+)"/i.exec(disposition)
  const fileName = matched?.[1]?.trim() || `${assetId}.bin`
  const bytes = Buffer.from(await response.arrayBuffer())
  return { bytes, contentType, fileName }
}

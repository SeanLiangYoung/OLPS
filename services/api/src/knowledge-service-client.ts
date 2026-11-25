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

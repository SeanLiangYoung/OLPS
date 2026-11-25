import { appConfig } from './config.js'

export class KnowledgeProjectBootstrapError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'KnowledgeProjectBootstrapError'
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

export async function ensureKnowledgeProjectForSite(siteId: string): Promise<void> {
  const { baseUrl, token } = requireKnowledgeServiceConfig()
  const url = `${baseUrl}/api/v1/projects/${encodeURIComponent(siteId)}/project`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    throw new KnowledgeProjectBootstrapError(
      `知识库服务不可达: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  if (!response.ok) {
    const body = await response.text()
    throw new KnowledgeProjectBootstrapError(`知识库项目初始化失败 HTTP ${response.status}: ${body}`)
  }
}
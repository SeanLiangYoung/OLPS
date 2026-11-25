export type KnowledgeHttpClientConfig = {
  baseUrl: string
  serviceToken: string
}

export type KnowledgeHttpResponse = {
  ok: boolean
  status: number
  /** 响应正文；JSON 已解析，非 JSON 则为原始字符串 */
  body: unknown
}

export type KnowledgeHttpClient = {
  request(method: string, pathname: string, init?: { query?: Record<string, string>; json?: unknown }): Promise<KnowledgeHttpResponse>
}

function joinUrl(baseUrl: string, pathname: string, query?: Record<string, string>): string {
  const base = baseUrl.replace(/\/+$/, '')
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  const url = new URL(`${base}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value)
      }
    }
  }
  return url.toString()
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) {
    return null
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return JSON.parse(text) as unknown
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export function createKnowledgeHttpClient(config: KnowledgeHttpClientConfig): KnowledgeHttpClient {
  const baseUrl = config.baseUrl.trim()
  if (!baseUrl) {
    throw new Error('KNOWLEDGE_SERVICE_URL 不能为空')
  }
  const serviceToken = config.serviceToken.trim()
  if (!serviceToken) {
    throw new Error('KNOWLEDGE_SERVICE_TOKEN 不能为空')
  }

  return {
    async request(method, pathname, init) {
      const url = joinUrl(baseUrl, pathname, init?.query)
      const headers: Record<string, string> = {
        Authorization: `Bearer ${serviceToken}`,
        Accept: 'application/json',
      }
      let body: string | undefined
      if (init?.json !== undefined) {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(init.json)
      }
      let res: Response
      try {
        res = await fetch(url, { method, headers, body })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        throw new KnowledgeHttpUnreachableError(
          `knowledge HTTP 不可用（无法连接 ${url}）：${detail}`,
          err,
        )
      }
      const parsed = await parseBody(res)
      return { ok: res.ok, status: res.status, body: parsed }
    },
  }
}

export class KnowledgeHttpUnreachableError extends Error {
  readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'KnowledgeHttpUnreachableError'
    this.cause = cause
  }
}

export function loadMcpHttpConfig(env: NodeJS.ProcessEnv): KnowledgeHttpClientConfig {
  const baseUrl = env.KNOWLEDGE_SERVICE_URL?.trim() ?? ''
  if (!baseUrl) {
    throw new Error('必须设置非空环境变量 KNOWLEDGE_SERVICE_URL')
  }
  const serviceToken = env.KNOWLEDGE_SERVICE_TOKEN?.trim() ?? ''
  if (!serviceToken) {
    throw new Error('必须设置非空环境变量 KNOWLEDGE_SERVICE_TOKEN')
  }
  return { baseUrl, serviceToken }
}

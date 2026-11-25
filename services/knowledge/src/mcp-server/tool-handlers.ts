import {
  KnowledgeHttpUnreachableError,
  type KnowledgeHttpClient,
  type KnowledgeHttpResponse,
} from './http-client.js'

export type KnowledgeToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export const KNOWLEDGE_TOOL_NAMES = [
  'olps_knowledge_status',
  'olps_knowledge_projects',
  'olps_knowledge_project',
  'olps_knowledge_files',
  'olps_knowledge_read_file',
  'olps_knowledge_search',
  'olps_knowledge_reviews',
  'olps_knowledge_assets',
  'olps_knowledge_write_page',
] as const

export type KnowledgeToolName = (typeof KNOWLEDGE_TOOL_NAMES)[number]

function okJson(body: unknown): KnowledgeToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
  }
}

function failText(message: string): KnowledgeToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`参数 ${key} 必须为非空字符串`)
  }
  return value.trim()
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error(`参数 ${key} 必须为字符串`)
  }
  return value.trim()
}

function formatHttpFailure(pathname: string, res: KnowledgeHttpResponse): string {
  let bodyText = ''
  if (typeof res.body === 'string') {
    bodyText = res.body
  } else if (res.body !== null && res.body !== undefined) {
    bodyText = JSON.stringify(res.body)
  }
  const suffix = bodyText ? `: ${bodyText}` : ''
  return `knowledge HTTP 请求失败 ${pathname} → HTTP ${res.status}${suffix}`
}

async function proxyJson(
  client: KnowledgeHttpClient,
  method: string,
  pathname: string,
  init?: { query?: Record<string, string>; json?: unknown },
): Promise<KnowledgeToolResult> {
  const res = await client.request(method, pathname, init)
  if (!res.ok) {
    return failText(formatHttpFailure(pathname, res))
  }
  return okJson(res.body)
}

export async function invokeKnowledgeTool(
  client: KnowledgeHttpClient,
  name: string,
  args: Record<string, unknown>,
): Promise<KnowledgeToolResult> {
  try {
    switch (name as KnowledgeToolName) {
      case 'olps_knowledge_status':
        return await proxyJson(client, 'GET', '/health')

      case 'olps_knowledge_projects':
        return await proxyJson(client, 'GET', '/api/v1/projects')

      case 'olps_knowledge_project': {
        const siteId = requireString(args, 'siteId')
        return await proxyJson(client, 'GET', `/api/v1/projects/${encodeURIComponent(siteId)}`)
      }

      case 'olps_knowledge_files': {
        const siteId = requireString(args, 'siteId')
        const prefix = optionalString(args, 'prefix')
        const query = prefix ? { prefix } : undefined
        return await proxyJson(
          client,
          'GET',
          `/api/v1/projects/${encodeURIComponent(siteId)}/files`,
          { query },
        )
      }

      case 'olps_knowledge_read_file': {
        const siteId = requireString(args, 'siteId')
        const filePath = requireString(args, 'path')
        return await proxyJson(
          client,
          'GET',
          `/api/v1/projects/${encodeURIComponent(siteId)}/files/content`,
          { query: { path: filePath } },
        )
      }

      case 'olps_knowledge_search': {
        const siteId = requireString(args, 'siteId')
        const query = requireString(args, 'query')
        const role = optionalString(args, 'role')
        const json: Record<string, string> = { query }
        if (role) {
          json.role = role
        }
        return await proxyJson(
          client,
          'POST',
          `/api/v1/projects/${encodeURIComponent(siteId)}/search`,
          { json },
        )
      }

      case 'olps_knowledge_reviews': {
        const siteId = requireString(args, 'siteId')
        const status = optionalString(args, 'status')
        const query = status ? { status } : undefined
        return await proxyJson(
          client,
          'GET',
          `/api/v1/projects/${encodeURIComponent(siteId)}/reviews`,
          { query },
        )
      }

      case 'olps_knowledge_assets': {
        const siteId = requireString(args, 'siteId')
        const role = optionalString(args, 'role')
        const query = role ? { role } : undefined
        return await proxyJson(
          client,
          'GET',
          `/api/v1/projects/${encodeURIComponent(siteId)}/assets`,
          { query },
        )
      }

      case 'olps_knowledge_write_page': {
        const siteId = requireString(args, 'siteId')
        const action = requireString(args, 'action')
        const documentId = requireString(args, 'documentId')
        const title = optionalString(args, 'title')
        const content = typeof args.content === 'string' ? args.content : undefined
        const json: Record<string, string> = { action, documentId }
        if (title !== undefined) {
          json.title = title
        }
        if (content !== undefined) {
          json.content = content
        }
        return await proxyJson(
          client,
          'POST',
          `/api/v1/projects/${encodeURIComponent(siteId)}/pages/write`,
          { json },
        )
      }

      default:
        return failText(`未知 MCP 工具: ${name}`)
    }
  } catch (err) {
    if (err instanceof KnowledgeHttpUnreachableError) {
      return failText(err.message)
    }
    const detail = err instanceof Error ? err.message : String(err)
    return failText(detail)
  }
}

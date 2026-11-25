import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { KnowledgeHttpClient } from './http-client.js'
import { invokeKnowledgeTool } from './tool-handlers.js'

function asArgs(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) {
    return {}
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('工具参数必须为对象')
  }
  return raw as Record<string, unknown>
}

export function createKnowledgeMcpServer(client: KnowledgeHttpClient): McpServer {
  const server = new McpServer({
    name: 'olps-knowledge',
    version: '0.1.0',
  })

  server.registerTool(
    'olps_knowledge_status',
    {
      title: 'Knowledge 服务状态',
      description: '调用 knowledge HTTP GET /health，返回存活状态。',
      inputSchema: {},
    },
    async () => invokeKnowledgeTool(client, 'olps_knowledge_status', {}),
  )

  server.registerTool(
    'olps_knowledge_projects',
    {
      title: '列出 Knowledge 项目',
      description: '调用 knowledge HTTP GET /api/v1/projects。',
      inputSchema: {},
    },
    async () => invokeKnowledgeTool(client, 'olps_knowledge_projects', {}),
  )

  server.registerTool(
    'olps_knowledge_project',
    {
      title: '项目摘要',
      description: '调用 knowledge HTTP GET /api/v1/projects/:siteId。',
      inputSchema: {
        siteId: z.string().describe('站点 siteId'),
      },
    },
    async (args) => invokeKnowledgeTool(client, 'olps_knowledge_project', asArgs(args)),
  )

  server.registerTool(
    'olps_knowledge_files',
    {
      title: '列出项目文件',
      description: '调用 knowledge HTTP GET /api/v1/projects/:siteId/files。',
      inputSchema: {
        siteId: z.string().describe('站点 siteId'),
        prefix: z.string().optional().describe('可选路径前缀，如 wiki 或 raw/sources'),
      },
    },
    async (args) => invokeKnowledgeTool(client, 'olps_knowledge_files', asArgs(args)),
  )

  server.registerTool(
    'olps_knowledge_read_file',
    {
      title: '读取项目文件',
      description: '调用 knowledge HTTP GET /api/v1/projects/:siteId/files/content。',
      inputSchema: {
        siteId: z.string().describe('站点 siteId'),
        path: z.string().describe('相对项目根的文件路径，如 wiki/index.md'),
      },
    },
    async (args) => invokeKnowledgeTool(client, 'olps_knowledge_read_file', asArgs(args)),
  )

  server.registerTool(
    'olps_knowledge_search',
    {
      title: '关键词检索',
      description: '调用 knowledge HTTP POST /api/v1/projects/:siteId/search。',
      inputSchema: {
        siteId: z.string().describe('站点 siteId'),
        query: z.string().describe('检索关键词'),
        role: z.string().optional().describe('可选素材角色过滤'),
      },
    },
    async (args) => invokeKnowledgeTool(client, 'olps_knowledge_search', asArgs(args)),
  )

  server.registerTool(
    'olps_knowledge_reviews',
    {
      title: '列出待审项',
      description: '调用 knowledge HTTP GET /api/v1/projects/:siteId/reviews。',
      inputSchema: {
        siteId: z.string().describe('站点 siteId'),
        status: z.string().optional().describe('可选状态过滤'),
      },
    },
    async (args) => invokeKnowledgeTool(client, 'olps_knowledge_reviews', asArgs(args)),
  )

  server.registerTool(
    'olps_knowledge_assets',
    {
      title: '列出素材',
      description: '调用 knowledge HTTP GET /api/v1/projects/:siteId/assets。',
      inputSchema: {
        siteId: z.string().describe('站点 siteId'),
        role: z.string().optional().describe('可选素材角色过滤'),
      },
    },
    async (args) => invokeKnowledgeTool(client, 'olps_knowledge_assets', asArgs(args)),
  )

  server.registerTool(
    'olps_knowledge_write_page',
    {
      title: '受控写入 Wiki 页',
      description: '调用 knowledge HTTP POST /api/v1/projects/:siteId/pages/write。',
      inputSchema: {
        siteId: z.string().describe('站点 siteId'),
        action: z.enum(['create', 'update', 'delete']).describe('写入动作'),
        documentId: z.string().describe('文档 UUID'),
        title: z.string().optional().describe('标题（create/update 必填）'),
        content: z.string().optional().describe('正文（create/update 必填）'),
      },
    },
    async (args) => invokeKnowledgeTool(client, 'olps_knowledge_write_page', asArgs(args)),
  )

  return server
}

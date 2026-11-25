import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from '../test-harness.js'
import { createKnowledgeHttpClient } from './http-client.js'
import { invokeKnowledgeTool } from './tool-handlers.js'

const token = 'knowledge-mcp-test-token'

async function ensureProject(baseUrl: string, siteId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/v1/projects/${siteId}/project`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status).toBe(200)
}

function textPayload(result: { content: Array<{ type: string; text?: string }> }): string {
  const parts = result.content.filter((c) => c.type === 'text' && typeof c.text === 'string')
  return parts.map((c) => c.text as string).join('\n')
}

describe('W5-T1 MCP 工具子集（HTTP 代理）', () => {
  it('olps_knowledge_search 对已启动 knowledge HTTP 成功检索', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('mcp-search')
    const siteId = 'mcp-search'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const projectDir = path.join(knowledgeRoot, siteId)
      await fs.writeFile(
        path.join(projectDir, 'wiki', 'mcp-product.md'),
        '# 银河洗碗机说明\n\n银河洗碗机具备蒸汽洗与烘干。\n',
        'utf8',
      )

      const client = createKnowledgeHttpClient({
        baseUrl,
        serviceToken: token,
      })
      const result = await invokeKnowledgeTool(client, 'olps_knowledge_search', {
        siteId,
        query: '银河洗碗机',
      })

      expect(result.isError).toBeFalsy()
      const payload = JSON.parse(textPayload(result)) as {
        hits: Array<{ path: string; snippet: string }>
      }
      expect(payload.hits.length).toBeGreaterThanOrEqual(1)
      expect(payload.hits.some((hit) => hit.path === 'wiki/mcp-product.md')).toBe(true)
    } finally {
      close()
    }
  })

  it('olps_knowledge_read_file 对已启动 knowledge HTTP 成功读文件', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('mcp-read-file')
    const siteId = 'mcp-read-file'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)

      const client = createKnowledgeHttpClient({
        baseUrl,
        serviceToken: token,
      })
      const result = await invokeKnowledgeTool(client, 'olps_knowledge_read_file', {
        siteId,
        path: 'wiki/index.md',
      })

      expect(result.isError).toBeFalsy()
      const payload = JSON.parse(textPayload(result)) as {
        path: string
        binary: boolean
        content?: string
      }
      expect(payload.path).toBe('wiki/index.md')
      expect(payload.binary).toBe(false)
      expect(payload.content).toContain('Knowledge index')
    } finally {
      close()
    }
  })

  it('knowledge HTTP 未启动时工具返回明确失败信息', async () => {
    const client = createKnowledgeHttpClient({
      baseUrl: 'http://127.0.0.1:1',
      serviceToken: token,
    })
    const result = await invokeKnowledgeTool(client, 'olps_knowledge_status', {})
    expect(result.isError).toBe(true)
    const message = textPayload(result)
    expect(message.length).toBeGreaterThan(0)
    expect(message).toMatch(/knowledge|HTTP|connect|ECONNREFUSED|fetch|unreachable|不可用|连接/i)
  })

  it('olps_knowledge_projects / files / assets / reviews 可代理到 HTTP', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('mcp-list-tools')
    const siteId = 'mcp-list-tools'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const client = createKnowledgeHttpClient({
        baseUrl,
        serviceToken: token,
      })

      const projects = await invokeKnowledgeTool(client, 'olps_knowledge_projects', {})
      expect(projects.isError).toBeFalsy()
      const projectsBody = JSON.parse(textPayload(projects)) as {
        projects: Array<{ siteId: string }>
      }
      expect(projectsBody.projects.some((p) => p.siteId === siteId)).toBe(true)

      const summary = await invokeKnowledgeTool(client, 'olps_knowledge_project', { siteId })
      expect(summary.isError).toBeFalsy()
      expect(JSON.parse(textPayload(summary))).toMatchObject({ siteId })

      const files = await invokeKnowledgeTool(client, 'olps_knowledge_files', {
        siteId,
        prefix: 'wiki',
      })
      expect(files.isError).toBeFalsy()
      const filesBody = JSON.parse(textPayload(files)) as {
        files: Array<{ path: string }>
      }
      expect(filesBody.files.some((f) => f.path === 'wiki/index.md')).toBe(true)

      const assets = await invokeKnowledgeTool(client, 'olps_knowledge_assets', { siteId })
      expect(assets.isError).toBeFalsy()
      expect(JSON.parse(textPayload(assets))).toHaveProperty('assets')

      const reviews = await invokeKnowledgeTool(client, 'olps_knowledge_reviews', { siteId })
      expect(reviews.isError).toBeFalsy()
      expect(JSON.parse(textPayload(reviews))).toHaveProperty('reviews')
    } finally {
      close()
    }
  })
})

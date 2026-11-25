import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'

const token = 'knowledge-test-token'

async function authFetch(baseUrl: string, pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
}

async function ensureProject(baseUrl: string, siteId: string): Promise<void> {
  const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
  expect(res.status).toBe(200)
}

describe('knowledge 项目文件列表与读取', () => {
  it('列出 wiki 前缀下的 Markdown 文件', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('files-list-wiki')
    const siteId = 'files-wiki'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/files?prefix=wiki`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { files: Array<{ path: string; size: number }> }
      const paths = body.files.map((f) => f.path).sort()
      expect(paths).toContain('wiki/index.md')
      expect(paths).toContain('wiki/log.md')
      expect(paths.every((p) => p.startsWith('wiki/'))).toBe(true)
    } finally {
      close()
    }
  })

  it('列出 raw/sources 前缀（含空目录占位）', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('files-list-raw')
    const siteId = 'files-raw'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const projectDir = path.join(knowledgeRoot, siteId)
      await fs.writeFile(path.join(projectDir, 'raw/sources/readme.txt'), 'hello sources\n', 'utf8')
      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/files?prefix=raw/sources`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { files: Array<{ path: string; size: number }> }
      expect(body.files.some((f) => f.path === 'raw/sources/readme.txt')).toBe(true)
    } finally {
      close()
    }
  })

  it('不带 prefix 时列出 raw 与 wiki 下全部文件', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('files-list-all')
    const siteId = 'files-all'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/files`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { files: Array<{ path: string; size: number }> }
      const paths = new Set(body.files.map((f) => f.path))
      expect(paths.has('wiki/overview.md')).toBe(true)
      expect([...paths].every((p) => p.startsWith('wiki/') || p.startsWith('raw/'))).toBe(true)
      expect(paths.has('purpose.md')).toBe(false)
    } finally {
      close()
    }
  })

  it('读取 wiki 文本文件返回正文', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('files-read-text')
    const siteId = 'files-text'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const res = await authFetch(
        baseUrl,
        `/api/v1/projects/${siteId}/files/content?path=${encodeURIComponent('wiki/index.md')}`,
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        path: string
        binary: boolean
        content?: string
        size: number
      }
      expect(body.path).toBe('wiki/index.md')
      expect(body.binary).toBe(false)
      expect(body.content).toContain('Knowledge index')
      expect(body.size).toBeGreaterThan(0)
    } finally {
      close()
    }
  })

  it('读取二进制文件只返回元数据', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('files-read-binary')
    const siteId = 'files-binary'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const projectDir = path.join(knowledgeRoot, siteId)
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
      await fs.writeFile(path.join(projectDir, 'raw/sources/logo.png'), pngBytes)
      const res = await authFetch(
        baseUrl,
        `/api/v1/projects/${siteId}/files/content?path=${encodeURIComponent('raw/sources/logo.png')}`,
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        path: string
        binary: boolean
        content?: string
        size: number
      }
      expect(body.path).toBe('raw/sources/logo.png')
      expect(body.binary).toBe(true)
      expect(body.content).toBeUndefined()
      expect(body.size).toBe(pngBytes.length)
    } finally {
      close()
    }
  })

  it.each([
    ['purpose.md', 'site_root_file'],
    ['wiki/../purpose.md', 'dotdot_escape'],
    ['raw/not-allowed/../../schema.md', 'nested_escape'],
  ])('非法路径 %s 返回 400', async (badPath) => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('files-bad-path')
    const siteId = 'files-bad'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const res = await authFetch(
        baseUrl,
        `/api/v1/projects/${siteId}/files/content?path=${encodeURIComponent(badPath)}`,
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('invalid_path')
    } finally {
      close()
    }
  })

  it('读取不存在的允许路径返回 404', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('files-missing')
    const siteId = 'files-missing'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const res = await authFetch(
        baseUrl,
        `/api/v1/projects/${siteId}/files/content?path=${encodeURIComponent('wiki/no-such-page.md')}`,
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('file_not_found')
    } finally {
      close()
    }
  })

  it('未初始化项目读取文件返回 404', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('files-no-project')
    const siteId = 'files-none'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      const res = await authFetch(
        baseUrl,
        `/api/v1/projects/${siteId}/files/content?path=${encodeURIComponent('wiki/index.md')}`,
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('project_not_found')
    } finally {
      close()
    }
  })
})
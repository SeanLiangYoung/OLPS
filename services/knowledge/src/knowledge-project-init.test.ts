import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'

const token = 'knowledge-test-token'

const EXPECTED_RELATIVE_PATHS = [
  'purpose.md',
  'schema.md',
  'raw/sources',
  'wiki/index.md',
  'wiki/log.md',
  'wiki/overview.md',
  'wiki/assets-catalog.md',
  '.olps-knowledge/imports',
  '.olps-knowledge/fingerprints.json',
  '.olps-knowledge/reviews.json',
] as const

async function authFetch(baseUrl: string, pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
}

async function collectProjectSnapshot(projectDir: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()

  async function walk(relativeDir: string): Promise<void> {
    const abs = path.join(projectDir, relativeDir)
    let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[]
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const rel = relativeDir ? `${relativeDir}/${ent.name}` : ent.name
      const relPosix = rel.split(path.sep).join('/')
      if (ent.isDirectory()) {
        snapshot.set(relPosix, '__dir__')
        await walk(rel)
      } else if (ent.isFile()) {
        const buf = await fs.readFile(path.join(projectDir, rel))
        const digest = createHash('sha256').update(buf).digest('hex')
        snapshot.set(relPosix, digest)
      }
    }
  }

  await walk('')
  return snapshot
}

describe('knowledge 站点项目目录初始化', () => {
  it('POST project 在站点根下创建设计约定的路径集', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('project-create')
    const siteId = 'site-alpha'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
      expect(res.status).toBe(200)

      const projectDir = path.join(knowledgeRoot, siteId)
      for (const rel of EXPECTED_RELATIVE_PATHS) {
        const target = path.join(projectDir, rel)
        const stat = await fs.stat(target)
        if (rel.endsWith('.md') || rel.endsWith('.json')) {
          expect(stat.isFile()).toBe(true)
        } else {
          expect(stat.isDirectory()).toBe(true)
        }
      }
    } finally {
      close()
    }
  })

  it('重复 POST project 不改变已有文件集合', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('project-idempotent')
    const siteId = 'site-beta'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      const first = await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
      expect(first.status).toBe(200)
      const projectDir = path.join(knowledgeRoot, siteId)
      const before = await collectProjectSnapshot(projectDir)

      const second = await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
      expect(second.status).toBe(200)
      const after = await collectProjectSnapshot(projectDir)

      expect(after.size).toBe(before.size)
      for (const [rel, digest] of before) {
        expect(after.get(rel)).toBe(digest)
      }
    } finally {
      close()
    }
  })

  it.each(['../escape', 'a/b', 'a\\b', ''])('非法 siteId %j 返回 400', async (badSiteId) => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('project-bad-id')
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      const encoded = badSiteId === '' ? '%20' : encodeURIComponent(badSiteId)
      const res = await authFetch(baseUrl, `/api/v1/projects/${encoded}/project`, { method: 'POST' })
      expect(res.status).toBe(400)
    } finally {
      close()
    }
  })

  it('非法 siteId ".." 被 siteId 规则拒绝', async () => {
    const { isLegalSiteId } = await import('./site-id.js')
    expect(isLegalSiteId('..')).toBe(false)
  })

  it('GET /api/v1/projects 与 GET /api/v1/projects/:siteId 返回预期摘要', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('project-list')
    const siteA = 'site-list-a'
    const siteB = 'site-list-b'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      expect((await authFetch(baseUrl, '/api/v1/projects')).status).toBe(200)
      const emptyList = (await (await authFetch(baseUrl, '/api/v1/projects')).json()) as {
        projects: unknown[]
      }
      expect(emptyList.projects).toEqual([])

      await authFetch(baseUrl, `/api/v1/projects/${siteA}/project`, { method: 'POST' })
      await authFetch(baseUrl, `/api/v1/projects/${siteB}/project`, { method: 'POST' })

      const listRes = await authFetch(baseUrl, '/api/v1/projects')
      expect(listRes.status).toBe(200)
      const listBody = (await listRes.json()) as {
        projects: Array<{
          siteId: string
          pageCount: number
          assetCount: number
          lastImport: null
        }>
      }
      expect(listBody.projects).toHaveLength(2)
      const byId = new Map(listBody.projects.map((p) => [p.siteId, p]))
      expect(byId.get(siteA)).toMatchObject({ pageCount: 4, assetCount: 0, lastImport: null })
      expect(byId.get(siteB)).toMatchObject({ pageCount: 4, assetCount: 0, lastImport: null })

      const oneRes = await authFetch(baseUrl, `/api/v1/projects/${siteA}`)
      expect(oneRes.status).toBe(200)
      const oneBody = (await oneRes.json()) as {
        siteId: string
        pageCount: number
        assetCount: number
        lastImport: null
      }
      expect(oneBody).toEqual({
        siteId: siteA,
        pageCount: 4,
        assetCount: 0,
        lastImport: null,
      })

      const missing = await authFetch(baseUrl, '/api/v1/projects/no-such-site')
      expect(missing.status).toBe(404)
    } finally {
      close()
    }
  })
})
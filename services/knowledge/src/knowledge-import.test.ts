import fs from 'node:fs/promises'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'

const token = 'knowledge-test-token'

async function authFetch(baseUrl: string, pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

async function ensureProject(baseUrl: string, siteId: string): Promise<void> {
  const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })
  expect(res.status).toBe(200)
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function buildZip(files: Record<string, string>): string {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, text] of Object.entries(files)) {
    entries[name] = strToU8(text)
  }
  return toBase64(zipSync(entries))
}

type ImportStatusBody = {
  importId: string
  siteId: string
  sourceName: string
  status: string
  stats: { fileCount: number; totalBytes: number; writtenPaths?: string[] }
  error: string | null
}

async function waitForImportStatus(
  baseUrl: string,
  siteId: string,
  importId: string,
  target: Set<string>,
  timeoutMs = 30_000,
): Promise<ImportStatusBody> {
  const deadline = Date.now() + timeoutMs
  let last: ImportStatusBody | null = null
  while (Date.now() < deadline) {
    const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports/${importId}`)
    expect(res.status).toBe(200)
    last = (await res.json()) as ImportStatusBody
    if (target.has(last.status)) {
      return last
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`导入 ${importId} 未在时限内到达状态 ${[...target].join('|')}，末次=${last?.status}`)
}

describe('knowledge 资料包导入', () => {
  it('合法 zip 解压后相对路径保留在 raw/sources', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('import-zip-ok')
    const siteId = 'import-zip'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const zipBase64 = buildZip({
        'pack/readme.md': '# readme\n',
        'pack/nested/note.txt': 'note\n',
      })
      const create = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'pack.zip', zipBase64 }),
      })
      expect(create.status).toBe(202)
      const created = (await create.json()) as { importId: string; status: string }
      const final = await waitForImportStatus(baseUrl, siteId, created.importId, new Set(['completed']))
      expect(final.stats.fileCount).toBe(2)
      const projectDir = path.join(knowledgeRoot, siteId)
      const readme = await fs.readFile(path.join(projectDir, 'raw/sources/pack/readme.md'), 'utf8')
      expect(readme).toContain('# readme')
      const note = await fs.readFile(path.join(projectDir, 'raw/sources/pack/nested/note.txt'), 'utf8')
      expect(note).toBe('note\n')
      const statusPath = path.join(projectDir, '.olps-knowledge/imports', created.importId, 'status.json')
      await fs.access(statusPath)
    } finally {
      close()
    }
  })

  it('多文件文件夹清单写入 raw/sources 且保留相对路径', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('import-files-ok')
    const siteId = 'import-files'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const create = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'folder',
          files: [
            { relativePath: 'docs/a.md', contentBase64: toBase64(strToU8('alpha')) },
            { relativePath: 'docs/sub/b.md', contentBase64: toBase64(strToU8('beta')) },
          ],
        }),
      })
      expect(create.status).toBe(202)
      const created = (await create.json()) as { importId: string }
      await waitForImportStatus(baseUrl, siteId, created.importId, new Set(['completed']))
      const projectDir = path.join(knowledgeRoot, siteId)
      expect(await fs.readFile(path.join(projectDir, 'raw/sources/docs/a.md'), 'utf8')).toBe('alpha')
      expect(await fs.readFile(path.join(projectDir, 'raw/sources/docs/sub/b.md'), 'utf8')).toBe('beta')
    } finally {
      close()
    }
  })

  it('合计体积超过上限时拒绝', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('import-total-limit')
    const siteId = 'import-total'
    const maxTotal = 200
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
      importMaxBytes: maxTotal,
      singleFileMaxBytes: 150,
    })
    try {
      await ensureProject(baseUrl, siteId)
      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'too-big',
          files: [
            { relativePath: 'a.bin', contentBase64: toBase64(new Uint8Array(120)) },
            { relativePath: 'b.bin', contentBase64: toBase64(new Uint8Array(120)) },
          ],
        }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('import_total_size_exceeded')
    } finally {
      close()
    }
  })

  it('单文件超过上限时拒绝', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('import-file-limit')
    const siteId = 'import-file'
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
      importMaxBytes: 10_000,
      singleFileMaxBytes: 50,
    })
    try {
      await ensureProject(baseUrl, siteId)
      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'big-one',
          files: [{ relativePath: 'big.bin', contentBase64: toBase64(new Uint8Array(80)) }],
        }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('import_file_size_exceeded')
    } finally {
      close()
    }
  })

  it('损坏 zip 拒绝', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('import-bad-zip')
    const siteId = 'import-bad-zip'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'broken.zip',
          zipBase64: toBase64(strToU8('not-a-zip-file')),
        }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('import_invalid_zip')
    } finally {
      close()
    }
  })

  it('空资料包（无文件项）拒绝', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('import-empty')
    const siteId = 'import-empty'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const resFiles = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'empty', files: [] }),
      })
      expect(resFiles.status).toBe(400)
      expect(((await resFiles.json()) as { error: string }).error).toBe('import_empty_package')

      const resZip = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'empty.zip', zipBase64: buildZip({}) }),
      })
      expect(resZip.status).toBe(400)
      expect(((await resZip.json()) as { error: string }).error).toBe('import_empty_package')
    } finally {
      close()
    }
  })

  it('zip 内非法相对路径拒绝', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('import-bad-path')
    const siteId = 'import-bad-path'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const res = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'escape.zip',
          zipBase64: buildZip({ '../escape.txt': 'x\n' }),
        }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('import_invalid_path')
    } finally {
      close()
    }
  })

  it('GET 可读导入状态', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('import-get-status')
    const siteId = 'import-get'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const create = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'one.txt',
          files: [{ relativePath: 'one.txt', contentBase64: toBase64(strToU8('1')) }],
        }),
      })
      expect(create.status).toBe(202)
      const { importId } = (await create.json()) as { importId: string }
      const done = await waitForImportStatus(baseUrl, siteId, importId, new Set(['completed']))
      expect(done.importId).toBe(importId)
      expect(done.siteId).toBe(siteId)
      expect(done.status).toBe('completed')
      expect(done.error).toBeNull()
      expect(done.stats.fileCount).toBe(1)
    } finally {
      close()
    }
  })

  it('同站第二次导入在第一次未完成时可观测 queued 状态', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('import-queue')
    const siteId = 'import-queue'
    const { baseUrl, close } = await startKnowledgeServer({ knowledgeRoot, serviceToken: token })
    try {
      await ensureProject(baseUrl, siteId)
      const manyFiles = Array.from({ length: 400 }, (_, index) => ({
        relativePath: `bulk/f-${index}.txt`,
        contentBase64: toBase64(strToU8(`payload-${index}-${'x'.repeat(200)}`)),
      }))
      const firstPromise = authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({ sourceName: 'bulk', files: manyFiles }),
      })
      await new Promise((resolve) => setImmediate(resolve))
      const secondRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          sourceName: 'small',
          files: [{ relativePath: 'tiny.txt', contentBase64: toBase64(strToU8('tiny')) }],
        }),
      })
      expect(secondRes.status).toBe(202)
      const second = (await secondRes.json()) as { importId: string }
      const firstRes = await firstPromise
      expect(firstRes.status).toBe(202)
      const first = (await firstRes.json()) as { importId: string }

      let sawQueued = false
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        const statusRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports/${second.importId}`)
        const status = (await statusRes.json()) as ImportStatusBody
        if (status.status === 'queued') {
          sawQueued = true
          break
        }
        const firstStatusRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports/${first.importId}`)
        const firstStatus = (await firstStatusRes.json()) as ImportStatusBody
        if (firstStatus.status === 'completed') {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      expect(sawQueued).toBe(true)
      await waitForImportStatus(baseUrl, siteId, first.importId, new Set(['completed']))
      await waitForImportStatus(baseUrl, siteId, second.importId, new Set(['completed']))
    } finally {
      close()
    }
  })
})
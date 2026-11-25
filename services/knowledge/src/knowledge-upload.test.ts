import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { makeIsolatedKnowledgeRoot, startKnowledgeServer } from './test-harness.js'

const token = 'knowledge-upload-token'

async function authFetch(baseUrl: string, pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
}

describe('knowledge 分片上传', () => {
  it('zip 分片上传可续传并完成导入', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('upload-zip')
    const siteId = 'upload-zip-site'
    const chunkBytes = 64
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
      uploadChunkBytes: chunkBytes,
    })
    try {
      expect((await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })).status).toBe(200)
      const zipBytes = Buffer.from(
        zipSync({
          'docs/a.txt': strToU8('hello-chunked-upload'),
        }),
      )
      const create = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'zip',
          sourceName: 'pack.zip',
          totalBytes: zipBytes.length,
          chunkBytes,
        }),
      })
      expect(create.status).toBe(201)
      const session = (await create.json()) as { uploadId: string; chunkBytes: number }
      const count = Math.ceil(zipBytes.length / chunkBytes)
      for (let index = 0; index < count; index += 1) {
        if (index === 1) continue
        const slice = zipBytes.subarray(index * chunkBytes, Math.min(zipBytes.length, (index + 1) * chunkBytes))
        const sha = createHash('sha256').update(slice).digest('hex')
        const put = await authFetch(
          baseUrl,
          `/api/v1/projects/${siteId}/imports/sessions/${session.uploadId}/chunks/${index}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': sha },
            body: slice,
          },
        )
        expect(put.status).toBe(200)
      }
      const incomplete = await authFetch(
        baseUrl,
        `/api/v1/projects/${siteId}/imports/sessions/${session.uploadId}/complete`,
        { method: 'POST' },
      )
      expect(incomplete.status).toBe(400)
      expect((await incomplete.json()).error).toBe('upload_incomplete')

      const missing = zipBytes.subarray(chunkBytes, Math.min(zipBytes.length, chunkBytes * 2))
      const putMissing = await authFetch(
        baseUrl,
        `/api/v1/projects/${siteId}/imports/sessions/${session.uploadId}/chunks/1`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: missing,
        },
      )
      expect(putMissing.status).toBe(200)

      const again = await authFetch(
        baseUrl,
        `/api/v1/projects/${siteId}/imports/sessions/${session.uploadId}/chunks/1`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: missing,
        },
      )
      expect(again.status).toBe(200)

      const complete = await authFetch(
        baseUrl,
        `/api/v1/projects/${siteId}/imports/sessions/${session.uploadId}/complete`,
        { method: 'POST' },
      )
      expect(complete.status).toBe(202)
      const created = (await complete.json()) as { importId: string; status: string }
      expect(created.status).toBe('queued')

      const deadline = Date.now() + 20_000
      let lastStatus = ''
      while (Date.now() < deadline) {
        const statusRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports/${created.importId}`)
        const body = (await statusRes.json()) as { status: string }
        lastStatus = body.status
        if (body.status === 'completed' || body.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(lastStatus).toBe('completed')
    } finally {
      close()
    }
  })

  it('files 分片上传完成导入', async () => {
    const knowledgeRoot = await makeIsolatedKnowledgeRoot('upload-files')
    const siteId = 'upload-files-site'
    const chunkBytes = 32
    const { baseUrl, close } = await startKnowledgeServer({
      knowledgeRoot,
      serviceToken: token,
      uploadChunkBytes: chunkBytes,
    })
    try {
      expect((await authFetch(baseUrl, `/api/v1/projects/${siteId}/project`, { method: 'POST' })).status).toBe(200)
      const content = Buffer.from('folder-file-payload-0123456789abcdef')
      const create = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'files',
          sourceName: 'folder',
          totalBytes: content.length,
          chunkBytes,
          files: [{ relativePath: 'docs/note.txt', size: content.length }],
        }),
      })
      expect(create.status).toBe(201)
      const session = (await create.json()) as { uploadId: string }
      const count = Math.ceil(content.length / chunkBytes)
      for (let index = 0; index < count; index += 1) {
        const slice = content.subarray(index * chunkBytes, Math.min(content.length, (index + 1) * chunkBytes))
        const put = await authFetch(
          baseUrl,
          `/api/v1/projects/${siteId}/imports/sessions/${session.uploadId}/files/0/chunks/${index}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: slice,
          },
        )
        expect(put.status).toBe(200)
      }
      const complete = await authFetch(
        baseUrl,
        `/api/v1/projects/${siteId}/imports/sessions/${session.uploadId}/complete`,
        { method: 'POST' },
      )
      expect(complete.status).toBe(202)
      const created = (await complete.json()) as { importId: string }
      const deadline = Date.now() + 20_000
      let lastStatus = ''
      while (Date.now() < deadline) {
        const statusRes = await authFetch(baseUrl, `/api/v1/projects/${siteId}/imports/${created.importId}`)
        const body = (await statusRes.json()) as { status: string }
        lastStatus = body.status
        if (body.status === 'completed' || body.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(lastStatus).toBe('completed')
    } finally {
      close()
    }
  })
})

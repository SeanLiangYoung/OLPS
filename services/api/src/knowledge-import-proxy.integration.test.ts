import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import type { Env, Hono } from 'hono'
import { expect, it } from 'vitest'
import { app } from './app.js'
import { resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

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

function buildZipBytes(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, text] of Object.entries(files)) {
    entries[name] = strToU8(text)
  }
  return zipSync(entries)
}

async function requestBinary<E extends Env>(
  target: Hono<E>,
  method: string,
  path: string,
  options: { token?: string; body?: Uint8Array; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/octet-stream'
  }
  const response = await target.request(path, {
    method,
    headers,
    body: options.body,
  })
  const text = await response.text()
  let body: Record<string, unknown> = {}
  if (text.trim()) {
    body = JSON.parse(text) as Record<string, unknown>
  }
  return { status: response.status, body }
}

async function waitImportViaApi(
  siteId: string,
  importId: string,
  token: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 60_000
  let last: Record<string, unknown> | null = null
  while (Date.now() < deadline) {
    const result = await requestJson(app, 'GET', `/api/sites/${siteId}/knowledge-base/imports/${importId}`, {
      token,
    })
    expect(result.status).toBe(200)
    last = result.body.import as Record<string, unknown>
    if (last.status === 'completed') return last
    if (last.status === 'failed') throw new Error(String(last.error))
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`导入未完成，末次状态=${String(last?.status)}`)
}

it('经 API 代理上传 zip 后资料列表出现投影文档', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'import-ui', password: 'Knowledge123!', name: '导入管理员' })
  const created = await requestJson(app, 'POST', '/api/sites', { token: owner.accessToken, body: { name: '导入站' } })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  await expect.poll(async () => {
    const result = await requestJson(app, 'GET', `/api/sites/${siteId}/initialization`, { token: owner.accessToken })
    if (result.body.initStatus === 'failed') throw new Error(String(result.body.error))
    return result.body.initStatus
  }, { timeout: 30_000 }).toBe('ready')

  const zipBase64 = buildZip({ 'docs/brand.md': '# 品牌介绍\n测试产品系列\n' })
  const createRes = await requestJson(app, 'POST', `/api/sites/${siteId}/knowledge-base/imports`, {
    token: owner.accessToken,
    body: { sourceName: 'brand.zip', zipBase64 },
  })
  expect(createRes.status).toBe(202)
  const importId = String(createRes.body.importId)
  const importStatus = await waitImportViaApi(siteId, importId, owner.accessToken)
  const stats = importStatus.stats as Record<string, unknown>
  expect(Number(stats.extracted)).toBeGreaterThanOrEqual(1)

  const listRes = await requestJson(app, 'GET', `/api/sites/${siteId}/knowledge-base/documents`, { token: owner.accessToken })
  expect(listRes.status).toBe(200)
  const documents = listRes.body.documents as Array<Record<string, unknown>>
  const projected = documents.find((doc) => doc.sourcePath === 'raw/sources/docs/brand.md')
  expect(projected).toBeDefined()
  expect(String(projected!.title)).toContain('brand')
  expect(String(projected!.content)).toContain('测试产品系列')
}, 120_000)

it('经 API 代理分片上传 zip 后可完成导入', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'import-chunk', password: 'Knowledge123!', name: '分片管理员' })
  const created = await requestJson(app, 'POST', '/api/sites', { token: owner.accessToken, body: { name: '分片站' } })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  await expect.poll(async () => {
    const result = await requestJson(app, 'GET', `/api/sites/${siteId}/initialization`, { token: owner.accessToken })
    if (result.body.initStatus === 'failed') throw new Error(String(result.body.error))
    return result.body.initStatus
  }, { timeout: 30_000 }).toBe('ready')

  const zipBytes = buildZipBytes({ 'docs/chunked.md': '# 分片资料\n可续传内容\n' })
  const sessionRes = await requestJson(app, 'POST', `/api/sites/${siteId}/knowledge-base/imports/sessions`, {
    token: owner.accessToken,
    body: {
      kind: 'zip',
      sourceName: 'chunked.zip',
      totalBytes: zipBytes.length,
      chunkBytes: 64,
    },
  })
  expect(sessionRes.status).toBe(201)
  const uploadId = String(sessionRes.body.uploadId)
  const chunkBytes = Number(sessionRes.body.chunkBytes)
  const chunkCount = Math.ceil(zipBytes.length / chunkBytes)
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * chunkBytes
    const slice = zipBytes.subarray(start, Math.min(zipBytes.length, start + chunkBytes))
    const sha = createHash('sha256').update(slice).digest('hex')
    const put = await requestBinary(
      app,
      'PUT',
      `/api/sites/${siteId}/knowledge-base/imports/sessions/${uploadId}/chunks/${index}`,
      {
        token: owner.accessToken,
        body: slice,
        headers: { 'X-Chunk-Sha256': sha },
      },
    )
    expect(put.status).toBe(200)
  }

  const complete = await requestJson(
    app,
    'POST',
    `/api/sites/${siteId}/knowledge-base/imports/sessions/${uploadId}/complete`,
    { token: owner.accessToken },
  )
  expect(complete.status).toBe(202)
  const importId = String(complete.body.importId)
  const importStatus = await waitImportViaApi(siteId, importId, owner.accessToken)
  const stats = importStatus.stats as Record<string, unknown>
  expect(Number(stats.extracted)).toBeGreaterThanOrEqual(1)

  const listRes = await requestJson(app, 'GET', `/api/sites/${siteId}/knowledge-base/documents`, {
    token: owner.accessToken,
  })
  expect(listRes.status).toBe(200)
  const documents = listRes.body.documents as Array<Record<string, unknown>>
  const projected = documents.find((doc) => doc.sourcePath === 'raw/sources/docs/chunked.md')
  expect(projected).toBeDefined()
  expect(String(projected!.content)).toContain('可续传内容')
}, 120_000)

it('资料包合计体积超限时返回明确中文错误', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'import-limit', password: 'Knowledge123!', name: '超限测试' })
  const created = await requestJson(app, 'POST', '/api/sites', { token: owner.accessToken, body: { name: '超限站' } })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  await expect.poll(async () => {
    const result = await requestJson(app, 'GET', `/api/sites/${siteId}/initialization`, { token: owner.accessToken })
    if (result.body.initStatus === 'failed') throw new Error(String(result.body.error))
    return result.body.initStatus
  }, { timeout: 30_000 }).toBe('ready')

  const chunk = toBase64(new Uint8Array(300))
  const res = await requestJson(app, 'POST', `/api/sites/${siteId}/knowledge-base/imports`, {
    token: owner.accessToken,
    body: {
      sourceName: 'too-big',
      files: [
        { relativePath: 'a.bin', contentBase64: chunk },
        { relativePath: 'b.bin', contentBase64: chunk },
      ],
    },
  })
  expect(res.status).toBe(400)
  expect(res.body.code).toBe('IMPORT_TOTAL_SIZE_EXCEEDED')
  expect(String(res.body.error)).toMatch(/体积|上限/)
})
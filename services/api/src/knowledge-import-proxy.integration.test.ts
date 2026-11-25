import { strToU8, zipSync } from 'fflate'
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
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { inject } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

const database = createTestPool()
afterAll(async () => {
  await database.end()
})

/** 1×1 PNG */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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

async function waitSiteReady(siteId: string, token: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await requestJson(app, 'GET', `/api/sites/${siteId}/initialization`, { token })
        if (result.body.initStatus === 'failed') throw new Error(String(result.body.error))
        return result.body.initStatus
      },
      { timeout: 30_000 },
    )
    .toBe('ready')
}

it('API 代理：resolve 后待审减 1；改角色后投影与 catalog 一致；错误码明确', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'review-admin', password: 'Knowledge123!', name: '待审管理员' })
  const created = await requestJson(app, 'POST', '/api/sites', {
    token: owner.accessToken,
    body: { name: '待审站' },
  })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  await waitSiteReady(siteId, owner.accessToken)

  const createImport = await requestJson(app, 'POST', `/api/sites/${siteId}/knowledge-base/imports`, {
    token: owner.accessToken,
    body: {
      sourceName: 'asset-pack',
      files: [{ relativePath: 'product/mark.png', contentBase64: TINY_PNG_BASE64 }],
    },
  })
  expect(createImport.status).toBe(202)
  const importId = String(createImport.body.importId)
  const importStatus = await waitImportViaApi(siteId, importId, owner.accessToken)
  const stats = importStatus.stats as Record<string, unknown>
  expect(Number(stats.assetsRegistered)).toBeGreaterThanOrEqual(1)

  const assetRows = await database.query(
    `SELECT a.asset_id, a.role, a.source_path
     FROM knowledge_assets a
     JOIN knowledge_bases k USING (kb_id)
     WHERE k.site_id = $1`,
    [siteId],
  )
  expect(assetRows.rowCount).toBeGreaterThanOrEqual(1)
  const assetId = String(assetRows.rows[0].asset_id)
  const sourcePath = String(assetRows.rows[0].source_path)

  const knowledgeRoot = inject('knowledgeDataRoot')
  const projectDir = path.join(knowledgeRoot, siteId)
  const reviewId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const reviewsPath = path.join(projectDir, '.olps-knowledge', 'reviews.json')
  await fs.writeFile(
    reviewsPath,
    `${JSON.stringify(
      [
        {
          id: reviewId,
          kind: 'asset_role_low_confidence',
          status: 'open',
          createdAt: new Date().toISOString(),
          importId,
          assetId,
          sourcePath,
          suggestedRole: 'product_image',
          confidence: 0.2,
          reason: '人工待审夹具',
        },
      ],
      null,
      2,
    )}\n`,
    'utf8',
  )

  const openBefore = await requestJson(app, 'GET', `/api/sites/${siteId}/knowledge-base/reviews?status=open`, {
    token: owner.accessToken,
  })
  expect(openBefore.status).toBe(200)
  const beforeReviews = openBefore.body.reviews as Array<Record<string, unknown>>
  expect(beforeReviews).toHaveLength(1)
  expect(beforeReviews[0]?.id).toBe(reviewId)

  const resolveRes = await requestJson(
    app,
    'POST',
    `/api/sites/${siteId}/knowledge-base/reviews/${reviewId}/resolve`,
    { token: owner.accessToken, body: {} },
  )
  expect(resolveRes.status).toBe(200)
  expect((resolveRes.body.review as Record<string, unknown>).status).toBe('resolved')

  const openAfter = await requestJson(app, 'GET', `/api/sites/${siteId}/knowledge-base/reviews?status=open`, {
    token: owner.accessToken,
  })
  expect(openAfter.status).toBe(200)
  expect((openAfter.body.reviews as unknown[]).length).toBe(0)

  const resolveAgain = await requestJson(
    app,
    'POST',
    `/api/sites/${siteId}/knowledge-base/reviews/${reviewId}/resolve`,
    { token: owner.accessToken, body: {} },
  )
  expect(resolveAgain.status).toBe(409)
  expect(resolveAgain.body.code).toBe('REVIEW_ALREADY_RESOLVED')

  const resolveMissing = await requestJson(
    app,
    'POST',
    `/api/sites/${siteId}/knowledge-base/reviews/00000000-0000-4000-8000-ffffffffffff/resolve`,
    { token: owner.accessToken, body: {} },
  )
  expect(resolveMissing.status).toBe(404)
  expect(resolveMissing.body.code).toBe('REVIEW_NOT_FOUND')

  const badRole = await requestJson(app, 'PATCH', `/api/sites/${siteId}/knowledge-base/assets/${assetId}`, {
    token: owner.accessToken,
    body: { role: 'not_a_role' },
  })
  expect(badRole.status).toBe(400)
  expect(badRole.body.code).toBe('INVALID_ROLE')

  const patchRes = await requestJson(app, 'PATCH', `/api/sites/${siteId}/knowledge-base/assets/${assetId}`, {
    token: owner.accessToken,
    body: { role: 'product_image', caption: '产品主图' },
  })
  expect(patchRes.status).toBe(200)
  expect((patchRes.body.asset as Record<string, unknown>).role).toBe('product_image')

  const projected = await database.query(
    `SELECT a.role, a.caption
     FROM knowledge_assets a
     JOIN knowledge_bases k USING (kb_id)
     WHERE k.site_id = $1 AND a.asset_id = $2`,
    [siteId, assetId],
  )
  expect(projected.rows[0].role).toBe('product_image')
  expect(projected.rows[0].caption).toBe('产品主图')

  const catalog = await fs.readFile(path.join(projectDir, 'wiki', 'assets-catalog.md'), 'utf8')
  expect(catalog).toContain(assetId)
  expect(catalog).toMatch(/\| product_image \|/)

  const assetsList = await requestJson(app, 'GET', `/api/sites/${siteId}/knowledge-base/assets`, {
    token: owner.accessToken,
  })
  expect(assetsList.status).toBe(200)
  const assets = assetsList.body.assets as Array<Record<string, unknown>>
  expect(assets.some((item) => item.assetId === assetId && item.role === 'product_image')).toBe(true)
}, 120_000)

import { randomUUID } from 'node:crypto'
import { afterAll, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

const database = createTestPool()
afterAll(async () => {
  await database.end()
})

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

it('文档列表返回 assetRefs 与关联素材角色', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'asset-refs-list', password: 'Knowledge123!', name: '素材列表' })
  const created = await requestJson(app, 'POST', '/api/sites', {
    token: owner.accessToken,
    body: { name: '素材统计站' },
  })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  await waitSiteReady(siteId, owner.accessToken)

  const kb = (await database.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1', [siteId])).rows[0]
  const productAssetId = randomUUID()
  const qrAssetId = randomUUID()
  const docWithAssets = randomUUID()
  const docEmpty = randomUUID()

  await database.query(
    `INSERT INTO knowledge_assets(
      asset_id,kb_id,import_id,source_path,fingerprint,mime_type,byte_size,
      width,height,role,caption,storage_key,created_at,updated_at
    ) VALUES
      ($1,$2,NULL,'raw/assets/product.png','fp-product','image/png',100,80,60,'product_image','主图','assets/product.png',NOW(),NOW()),
      ($3,$2,NULL,'raw/assets/qr.png','fp-qr','image/png',40,20,20,'qr_code','收款码','assets/qr.png',NOW(),NOW())`,
    [productAssetId, kb.kb_id, qrAssetId],
  )
  await database.query(
    `INSERT INTO knowledge_documents(doc_id,kb_id,title,content,kind,asset_refs,created_at,updated_at)
     VALUES
       ($1,$2,'有素材','正文 A','wiki_page',$3::jsonb,NOW(),NOW()),
       ($4,$2,'无素材','正文 B','manual','[]'::jsonb,NOW(),NOW())`,
    [docWithAssets, kb.kb_id, JSON.stringify([productAssetId, qrAssetId]), docEmpty],
  )

  const listRes = await requestJson(app, 'GET', `/api/sites/${siteId}/knowledge-base/documents`, {
    token: owner.accessToken,
  })
  expect(listRes.status).toBe(200)
  const documents = listRes.body.documents as Array<Record<string, unknown>>
  const withAssets = documents.find((doc) => doc.documentId === docWithAssets)
  const empty = documents.find((doc) => doc.documentId === docEmpty)
  expect(withAssets).toBeDefined()
  expect(empty).toBeDefined()
  expect(withAssets!.assetRefs).toEqual([productAssetId, qrAssetId])
  expect(empty!.assetRefs).toEqual([])
  const assets = withAssets!.assets as Array<{ assetId: string; role: string | null }>
  expect(assets).toEqual(
    expect.arrayContaining([
      { assetId: productAssetId, role: 'product_image' },
      { assetId: qrAssetId, role: 'qr_code' },
    ]),
  )
  expect(assets).toHaveLength(2)
  expect(empty!.assets).toEqual([])
}, 60_000)

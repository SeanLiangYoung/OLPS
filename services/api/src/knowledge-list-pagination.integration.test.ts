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

it('文字资料与媒体资料列表按时间倒序分页', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'page-owner', password: 'Knowledge123!', name: '分页管理员' })
  const created = await requestJson(app, 'POST', '/api/sites', {
    token: owner.accessToken,
    body: { name: '分页站' },
  })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  await waitSiteReady(siteId, owner.accessToken)

  const docsPath = `/api/sites/${siteId}/knowledge-base/documents`
  const first = await requestJson(app, 'POST', docsPath, {
    token: owner.accessToken,
    body: { title: '较早资料', content: '正文甲' },
  })
  expect(first.status).toBe(201)
  await new Promise((resolve) => setTimeout(resolve, 20))
  const second = await requestJson(app, 'POST', docsPath, {
    token: owner.accessToken,
    body: { title: '较新资料', content: '正文乙' },
  })
  expect(second.status).toBe(201)

  const page1 = await requestJson(app, 'GET', `${docsPath}?page=1&pageSize=1`, { token: owner.accessToken })
  expect(page1.status).toBe(200)
  expect(page1.body.total).toBe(2)
  expect(page1.body.page).toBe(1)
  expect(page1.body.pageSize).toBe(1)
  expect(page1.body.documents).toHaveLength(1)
  expect((page1.body.documents as Array<Record<string, unknown>>)[0].title).toBe('较新资料')

  const page2 = await requestJson(app, 'GET', `${docsPath}?page=2&pageSize=1`, { token: owner.accessToken })
  expect(page2.status).toBe(200)
  expect(page2.body.documents).toHaveLength(1)
  expect((page2.body.documents as Array<Record<string, unknown>>)[0].title).toBe('较早资料')

  const kb = await database.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1', [siteId])
  const kbId = String(kb.rows[0].kb_id)
  await database.query(
    `INSERT INTO knowledge_assets(
      asset_id, kb_id, import_id, source_path, fingerprint, mime_type, byte_size, width, height,
      role, caption, storage_key, created_at, updated_at
    ) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',$1,NULL,'raw/assets/old.png','fp-old','image/png',10,1,1,'other',NULL,'assets/old.png',NOW() - INTERVAL '1 minute',NOW()),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',$1,NULL,'raw/assets/new.png','fp-new','image/png',10,1,1,'logo',NULL,'assets/new.png',NOW(),NOW())`,
    [kbId],
  )

  const assetsPath = `/api/sites/${siteId}/knowledge-base/assets`
  const assetsPage1 = await requestJson(app, 'GET', `${assetsPath}?page=1&pageSize=1`, {
    token: owner.accessToken,
  })
  expect(assetsPage1.status).toBe(200)
  expect(assetsPage1.body.total).toBe(2)
  expect(assetsPage1.body.assets).toHaveLength(1)
  expect((assetsPage1.body.assets as Array<Record<string, unknown>>)[0].sourcePath).toBe('raw/assets/new.png')

  const assetsPage2 = await requestJson(app, 'GET', `${assetsPath}?page=2&pageSize=1`, {
    token: owner.accessToken,
  })
  expect(assetsPage2.status).toBe(200)
  expect(assetsPage2.body.assets).toHaveLength(1)
  expect((assetsPage2.body.assets as Array<Record<string, unknown>>)[0].sourcePath).toBe('raw/assets/old.png')
}, 60_000)

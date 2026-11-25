import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { afterAll, expect, inject, it } from 'vitest'
import { app } from './app.js'
import { pool } from './db.js'
import { saveContentBatch, type ManagedContent } from './content-sandbox.js'
import { fetchDraftRow, openDraftWorkspaceFromRow } from './draft-preview-support.js'
import { promoteKnowledgeAssets } from './promote-knowledge-assets.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

const database = createTestPool()
afterAll(async () => {
  await database.end()
})

/** 含 ftyp 的最小合法 MP4，可供 file-type 识别为 video/mp4 */
const MINIMAL_MP4 = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=', 'base64')

function countAssetIdMentions(value: unknown): number {
  const serialized = JSON.stringify(value)
  return (serialized.match(/"assetId"/g) ?? []).length
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

it('promoteKnowledgeAssets：image/video 去 assetId、二次复用 mediaId、sandbox 有 uploads 与 media 元数据', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, { account: 'promote-admin', password: 'Knowledge123!', name: '提升管理员' })
  const created = await requestJson(app, 'POST', '/api/sites', {
    token: owner.accessToken,
    body: { name: '提升站' },
  })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  const draftId = String((created.body.draft as Record<string, unknown>).draftId)
  const userId = String(owner.user.userId)
  await waitSiteReady(siteId, owner.accessToken)

  const knowledgeRoot = inject('knowledgeDataRoot')
  const projectDir = path.join(knowledgeRoot, siteId)
  const imageAssetId = randomUUID()
  const videoAssetId = randomUUID()
  const imageBytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#224466' } }).png().toBuffer()
  const videoBytes = MINIMAL_MP4
  const videoPath = path.join(projectDir, 'raw', 'sources', 'promo', 'clip.mp4')
  await fs.mkdir(path.dirname(videoPath), { recursive: true })
  await fs.writeFile(videoPath, videoBytes)

  const imageSourcePath = 'raw/sources/promo/hero.png'
  const imageAbs = path.join(projectDir, ...imageSourcePath.split('/'))
  await fs.mkdir(path.dirname(imageAbs), { recursive: true })
  await fs.writeFile(imageAbs, imageBytes)

  await fs.mkdir(path.join(projectDir, '.olps-knowledge', 'asset-meta'), { recursive: true })
  await fs.writeFile(
    path.join(projectDir, '.olps-knowledge', 'asset-meta', `${imageAssetId}.json`),
    `${JSON.stringify({
      assetId: imageAssetId,
      sourcePath: imageSourcePath,
      kind: 'image',
      mime: 'image/png',
      sizeBytes: imageBytes.length,
      width: 8,
      height: 6,
      importId: randomUUID(),
      fingerprint: 'b'.repeat(64),
      role: 'product_image',
    }, null, 2)}\n`,
  )
  await fs.writeFile(
    path.join(projectDir, '.olps-knowledge', 'asset-meta', `${videoAssetId}.json`),
    `${JSON.stringify({
      assetId: videoAssetId,
      sourcePath: 'raw/sources/promo/clip.mp4',
      kind: 'video',
      mime: 'video/mp4',
      sizeBytes: videoBytes.length,
      importId: randomUUID(),
      fingerprint: 'c'.repeat(64),
      role: 'product_video',
    }, null, 2)}\n`,
  )

  const kb = (await database.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1', [siteId])).rows[0]
  await database.query(
    `INSERT INTO knowledge_assets(
      asset_id,kb_id,import_id,source_path,fingerprint,mime_type,byte_size,
      width,height,role,caption,storage_key,promoted_media,created_at,updated_at
    ) VALUES
      ($1,$2,NULL,$3,'fp-image','image/png',$4,8,6,'product_image','主图',$3,'{}'::jsonb,NOW(),NOW()),
      ($5,$2,NULL,'raw/sources/promo/clip.mp4','fp-video','video/mp4',$6,NULL,NULL,'product_video','短片','raw/sources/promo/clip.mp4','{}'::jsonb,NOW(),NOW())`,
    [imageAssetId, kb.kb_id, imageSourcePath, imageBytes.length, videoAssetId, videoBytes.length],
  )

  const row = await fetchDraftRow(draftId)
  const workspace = await openDraftWorkspaceFromRow(row)
  const context = { workspace, database: pool, draftId, userId }

  const now = new Date().toISOString()
  const pageId = randomUUID()
  const contentWithAssets: ManagedContent = {
    ref: 'page',
    meta: {
      schemaVersion: 1,
      pageId,
      role: null,
      template: 'page',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    },
    locale: {
      schemaVersion: 1,
      locale: 'en',
      slug: `promote-${pageId}`,
      title: 'Promote page',
      summary: '',
      cover: { assetId: imageAssetId },
      seo: { title: 'Promote', description: 'promo', ogImage: { assetId: videoAssetId } },
      blocks: [
        {
          id: randomUUID(),
          type: 'core/image',
          props: { image: { assetId: imageAssetId }, alt: 'hero' },
          children: [],
        },
      ],
      sourceHash: null,
      updatedAt: now,
    },
  }
  expect(countAssetIdMentions(contentWithAssets)).toBeGreaterThanOrEqual(2)

  const promoted = await promoteKnowledgeAssets(context, siteId, contentWithAssets)
  expect(countAssetIdMentions(promoted)).toBe(0)
  const coverMediaId = (promoted.locale.cover as { mediaId: string }).mediaId
  const ogMediaId = (promoted.locale.seo as { ogImage: { mediaId: string } }).ogImage.mediaId
  const blockMediaId = (
    (promoted.locale.blocks as Array<{ props: { image: { mediaId: string } } }>)[0].props.image
  ).mediaId
  expect(coverMediaId).toBe(blockMediaId)
  expect(ogMediaId).not.toBe(coverMediaId)

  const mediaCountAfterFirst = (
    await database.query('SELECT COUNT(*)::int AS n FROM media WHERE draft_id=$1', [draftId])
  ).rows[0].n as number
  expect(mediaCountAfterFirst).toBe(2)

  const promotedRow = await database.query(
    'SELECT promoted_media FROM knowledge_assets WHERE asset_id=$1',
    [imageAssetId],
  )
  expect(promotedRow.rows[0].promoted_media[draftId]).toBe(coverMediaId)

  const again = await promoteKnowledgeAssets(context, siteId, contentWithAssets)
  expect(countAssetIdMentions(again)).toBe(0)
  expect((again.locale.cover as { mediaId: string }).mediaId).toBe(coverMediaId)
  expect((again.locale.seo as { ogImage: { mediaId: string } }).ogImage.mediaId).toBe(ogMediaId)
  const mediaCountAfterSecond = (
    await database.query('SELECT COUNT(*)::int AS n FROM media WHERE draft_id=$1', [draftId])
  ).rows[0].n as number
  expect(mediaCountAfterSecond).toBe(mediaCountAfterFirst)

  await saveContentBatch(context, [{ content: promoted, revision: null }])

  const files = await workspace.listFiles('')
  expect(files.some((file) => file.startsWith('assets/uploads/') && file.endsWith('.png'))).toBe(true)
  expect(files.some((file) => file.startsWith('assets/uploads/') && file.endsWith('.mp4'))).toBe(true)
  expect(files.some((file) => file.startsWith('source/media/') && file.endsWith('.json'))).toBe(true)
  expect(files.filter((file) => file.startsWith('source/media/') && file.endsWith('.json')).length).toBeGreaterThanOrEqual(2)
}, 180000)

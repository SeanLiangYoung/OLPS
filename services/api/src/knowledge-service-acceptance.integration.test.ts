import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import sharp from 'sharp'
import { afterAll, expect, inject, it } from 'vitest'
import { app } from './app.js'
import { pool } from './db.js'
import { saveContentBatch, type ManagedContent } from './content-sandbox.js'
import { fetchDraftRow, openDraftWorkspaceFromRow } from './draft-preview-support.js'
import { promoteKnowledgeAssets } from './promote-knowledge-assets.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { knowledgeIntegrationToken } from './test-support/knowledge-process.js'

const database = createTestPool()
afterAll(async () => {
  await database.end()
})

/** 含 ftyp 的最小合法 MP4，可供 file-type 识别为 video/mp4 */
const MINIMAL_MP4 = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=', 'base64')

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

function countAssetIdMentions(value: unknown): number {
  return (JSON.stringify(value).match(/"assetId"/g) ?? []).length
}

async function knowledgeFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const base = process.env.KNOWLEDGE_SERVICE_URL!
  const token = process.env.KNOWLEDGE_SERVICE_TOKEN ?? knowledgeIntegrationToken
  return fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
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

async function waitImportCompleted(siteId: string, importId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 60_000
  let last: Record<string, unknown> | null = null
  while (Date.now() < deadline) {
    const res = await knowledgeFetch(`/api/v1/projects/${siteId}/imports/${importId}`)
    expect(res.status).toBe(200)
    last = (await res.json()) as Record<string, unknown>
    if (last.status === 'completed') return last
    if (last.status === 'failed') throw new Error(String(last.error))
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`导入未完成，末次状态=${String(last?.status)}`)
}

// §11.4
it('§11.4 promote：image/video 最终 props 为 mediaId，sandbox 有 uploads 与 source/media/*.json', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, {
    account: 's11-promote-admin',
    password: 'Knowledge123!',
    name: '总验收提升管理员',
  })
  const created = await requestJson(app, 'POST', '/api/sites', {
    token: owner.accessToken,
    body: { name: '总验收提升站' },
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
  const imageBytes = await sharp({
    create: { width: 8, height: 6, channels: 3, background: '#224466' },
  })
    .png()
    .toBuffer()
  const videoBytes = MINIMAL_MP4

  const imageSourcePath = 'raw/sources/promo/hero.png'
  const videoSourcePath = 'raw/sources/promo/clip.mp4'
  for (const [sourcePath, bytes] of [
    [imageSourcePath, imageBytes],
    [videoSourcePath, videoBytes],
  ] as const) {
    const abs = path.join(projectDir, ...sourcePath.split('/'))
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, bytes)
  }

  await fs.mkdir(path.join(projectDir, '.olps-knowledge', 'asset-meta'), { recursive: true })
  await fs.writeFile(
    path.join(projectDir, '.olps-knowledge', 'asset-meta', `${imageAssetId}.json`),
    `${JSON.stringify(
      {
        assetId: imageAssetId,
        sourcePath: imageSourcePath,
        kind: 'image',
        mime: 'image/png',
        sizeBytes: imageBytes.length,
        width: 8,
        height: 6,
        importId: randomUUID(),
        fingerprint: 'd'.repeat(64),
        role: 'product_image',
      },
      null,
      2,
    )}\n`,
  )
  await fs.writeFile(
    path.join(projectDir, '.olps-knowledge', 'asset-meta', `${videoAssetId}.json`),
    `${JSON.stringify(
      {
        assetId: videoAssetId,
        sourcePath: videoSourcePath,
        kind: 'video',
        mime: 'video/mp4',
        sizeBytes: videoBytes.length,
        importId: randomUUID(),
        fingerprint: 'e'.repeat(64),
        role: 'product_video',
      },
      null,
      2,
    )}\n`,
  )

  const kb = (await database.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1', [siteId])).rows[0]
  await database.query(
    `INSERT INTO knowledge_assets(
      asset_id,kb_id,import_id,source_path,fingerprint,mime_type,byte_size,
      width,height,role,caption,storage_key,promoted_media,created_at,updated_at
    ) VALUES
      ($1,$2,NULL,$3,'fp-image','image/png',$4,8,6,'product_image','主图',$3,'{}'::jsonb,NOW(),NOW()),
      ($5,$2,NULL,$6,'fp-video','video/mp4',$7,NULL,NULL,'product_video','短片',$6,'{}'::jsonb,NOW(),NOW())`,
    [imageAssetId, kb.kb_id, imageSourcePath, imageBytes.length, videoAssetId, videoSourcePath, videoBytes.length],
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
      slug: `s11-promote-${pageId}`,
      title: 'S11 promote page',
      summary: '',
      cover: { assetId: imageAssetId },
      seo: { title: 'S11', description: 'promo', ogImage: { assetId: videoAssetId } },
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
  expect((promoted.locale.cover as { mediaId: string }).mediaId).toMatch(/\S/)
  expect((promoted.locale.seo as { ogImage: { mediaId: string } }).ogImage.mediaId).toMatch(/\S/)
  expect(
    (promoted.locale.blocks as Array<{ props: { image: { mediaId: string } } }>)[0].props.image.mediaId,
  ).toMatch(/\S/)

  await saveContentBatch(context, [{ content: promoted, revision: null }])

  const files = await workspace.listFiles('')
  expect(files.some((file) => file.startsWith('assets/uploads/') && file.endsWith('.png'))).toBe(true)
  expect(files.some((file) => file.startsWith('assets/uploads/') && file.endsWith('.mp4'))).toBe(true)
  expect(files.filter((file) => file.startsWith('source/media/') && file.endsWith('.json')).length).toBeGreaterThanOrEqual(
    2,
  )
}, 180_000)

// §11.6
it('§11.6 只改 Postgres 后触发投影重建，与 Wiki/抽取源一致', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, {
    account: 's11-rebuild-admin',
    password: 'Knowledge123!',
    name: '总验收重建管理员',
  })
  const created = await requestJson(app, 'POST', '/api/sites', {
    token: owner.accessToken,
    body: { name: '总验收重建站' },
  })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  await waitSiteReady(siteId, owner.accessToken)

  const zipBase64 = buildZip({ 'pack/note.txt': '权威正文-s11\n' })
  const createRes = await knowledgeFetch(`/api/v1/projects/${siteId}/imports`, {
    method: 'POST',
    body: JSON.stringify({ sourceName: 'pack.zip', zipBase64 }),
  })
  expect(createRes.status).toBe(202)
  const createdImport = (await createRes.json()) as { importId: string }
  await waitImportCompleted(siteId, createdImport.importId)

  const kb = (await database.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1', [siteId])).rows[0]
  await database.query(
    "UPDATE knowledge_documents SET content='被篡改-s11' WHERE kb_id=$1 AND source_path='raw/sources/pack/note.txt'",
    [kb.kb_id],
  )

  const tampered = await requestJson(app, 'GET', `/api/sites/${siteId}/knowledge-base/documents`, {
    token: owner.accessToken,
  })
  const tamperedDoc = (tampered.body.documents as Array<Record<string, unknown>>).find(
    (doc) => doc.sourcePath === 'raw/sources/pack/note.txt',
  )
  expect(tamperedDoc?.content).toBe('被篡改-s11')

  const rebuildRes = await knowledgeFetch(`/api/v1/projects/${siteId}/projection/rebuild`, {
    method: 'POST',
    body: JSON.stringify({ importId: createdImport.importId }),
  })
  expect(rebuildRes.status).toBe(200)

  const listRes = await requestJson(app, 'GET', `/api/sites/${siteId}/knowledge-base/documents`, {
    token: owner.accessToken,
  })
  const projected = (listRes.body.documents as Array<Record<string, unknown>>).find(
    (doc) => doc.sourcePath === 'raw/sources/pack/note.txt',
  )
  expect(projected?.content).toBe('权威正文-s11\n')
}, 120_000)

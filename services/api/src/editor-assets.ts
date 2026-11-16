import { createHash, randomUUID } from 'node:crypto'
import sharp, { type OutputInfo } from 'sharp'
import { z } from 'zod'
import { pool } from './db.js'
import { isDraftOwner } from './permissions.js'
import { openDraftWorkspace } from './workspace-factory.js'
import { withDraftLock } from './draft-lock.js'
import { assertDraftOrdinaryEditAllowed } from './draft-ordinary-edit-guard.js'
import { persistDraftSyncState } from './draft-sync-state.js'
import { createPreviewToken, insertPreviewCapability, resolvePreviewCapability } from './preview-capability-store.js'

export const EDITOR_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const EDITOR_IMAGE_MAX_PIXELS = 40_000_000
const RECORD_DIRECTORY = 'source/editor-assets'
const assetRecordSchema = z.object({
  assetId: z.uuid(), draftId: z.string(), siteId: z.string().nullable(),
  digest: z.string().regex(/^[a-f0-9]{64}$/), name: z.string(),
  width: z.number().int().positive(), height: z.number().int().positive(),
  mimeType: z.literal('image/webp'), createdBy: z.string(), createdAt: z.iso.datetime(),
})
export type EditorAssetRecord = z.infer<typeof assetRecordSchema>
export type EditorAsset = EditorAssetRecord & { url: string; previewUrl: string }

export async function openEditorWorkspace(userId: string, draftId: string, editable = false) {
  if (!(await isDraftOwner(userId, draftId))) throw new Error('FORBIDDEN')
  const result = await pool.query('SELECT * FROM site_drafts WHERE draft_id=$1', [draftId])
  if (!result.rowCount) throw new Error('NOT_FOUND')
  const row = result.rows[0]!
  if (editable) assertDraftOrdinaryEditAllowed(row)
  const workspace = await openDraftWorkspace({
    draftId, sandboxId: String(row.sandbox_id), siteId: row.site_id ? String(row.site_id) : null,
    draftRemoteSiteId: row.remote_site_id ? String(row.remote_site_id) : null,
    baseCommitId: row.base_commit_id ? String(row.base_commit_id) : null,
    headCommitId: row.head_commit_id ? String(row.head_commit_id) : null,
  })
  return { workspace, row }
}

async function presentAsset(record: EditorAssetRecord, userId: string, sessionId: string, draftId: string): Promise<EditorAsset> {
  const rawToken = createPreviewToken()
  await insertPreviewCapability({
    sessionId, userId, draftId, pageId: `editor-asset:${record.assetId}`,
    pageSlug: '', entryRoute: '', rawToken,
  })
  return { ...record, url: `/assets/${record.digest}.webp`, previewUrl: `/api/drafts/${encodeURIComponent(draftId)}/assets/${record.assetId}/preview?token=${rawToken}` }
}

export async function uploadEditorAsset(input: { userId: string; sessionId: string; draftId: string; file: File }): Promise<EditorAsset> {
  return withDraftLock(input.draftId, async () => {
    const { workspace, row } = await openEditorWorkspace(input.userId, input.draftId, true)
    if (input.file.size > EDITOR_IMAGE_MAX_BYTES) throw new Error('IMAGE_TOO_LARGE')
    if (!input.file.size) throw new Error('INVALID_IMAGE')
    const bytes = Buffer.from(await input.file.arrayBuffer())
    let converted: { data: Buffer; info: OutputInfo }
    try {
      const image = sharp(bytes, { limitInputPixels: EDITOR_IMAGE_MAX_PIXELS, failOn: 'warning', animated: true })
      const metadata = await image.metadata()
      if (!metadata.format || !['jpeg', 'png', 'webp', 'gif'].includes(metadata.format)) throw new Error('INVALID_IMAGE')
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > EDITOR_IMAGE_MAX_PIXELS) throw new Error('INVALID_IMAGE')
      converted = await image.rotate().webp({ quality: 90 }).toBuffer({ resolveWithObject: true })
    } catch {
      throw new Error('INVALID_IMAGE')
    }
    const digest = createHash('sha256').update(converted.data).digest('hex')
    const relative = `assets/${digest}.webp`
    const files = await workspace.listFiles('assets')
    if (!files.includes(relative)) await workspace.writeFile(relative, converted.data)
    const record: EditorAssetRecord = {
      assetId: randomUUID(), draftId: input.draftId, siteId: row.site_id ? String(row.site_id) : null,
      digest, name: input.file.name, width: converted.info.width,
      height: converted.info.pageHeight ?? converted.info.height, mimeType: 'image/webp',
      createdBy: input.userId, createdAt: new Date().toISOString(),
    }
    await workspace.writeFile(`${RECORD_DIRECTORY}/${record.assetId}.json`, Buffer.from(JSON.stringify(record, null, 2)))
    await persistDraftSyncState(input.draftId, { syncStatus: 'dirty', headCommitId: workspace.getState().headCommitId })
    return presentAsset(record, input.userId, input.sessionId, input.draftId)
  })
}

export async function listEditorAssets(userId: string, sessionId: string, draftId: string): Promise<EditorAsset[]> {
  const { workspace } = await openEditorWorkspace(userId, draftId)
  const files = await workspace.listFiles(RECORD_DIRECTORY)
  const assets: EditorAsset[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const record = assetRecordSchema.parse(JSON.parse((await workspace.readFile(file)).toString('utf8')))
    assets.push(await presentAsset(record, userId, sessionId, draftId))
  }
  return assets
}

export async function readEditorAssetPreview(draftId: string, assetId: string, token: string): Promise<Buffer> {
  if (!z.uuid().safeParse(assetId).success) throw new Error('NOT_FOUND')
  const capability = await resolvePreviewCapability(token)
  if (!capability || capability.draftId !== draftId || capability.pageId !== `editor-asset:${assetId}`) throw new Error('FORBIDDEN')
  const { workspace } = await openEditorWorkspace(capability.userId, draftId)
  const record = assetRecordSchema.parse(JSON.parse((await workspace.readFile(`${RECORD_DIRECTORY}/${assetId}.json`)).toString('utf8')))
  return workspace.readFile(`assets/${record.digest}.webp`)
}

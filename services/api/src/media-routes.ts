import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import sharp, { type Metadata } from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { allowedMediaExtensions, assertValidSchema, type MediaMeta } from '@olps/domain'
import { requireAuth, type AuthVariables } from './auth-middleware.js'
import { ContentError, withContentTransaction, type ContentContext } from './content-sandbox.js'
import { expectedRevision, managedResourceContext, readResource, resourceErrorResponse, resourceId, resourceLimit, resourceRevision, resourceUsages, writeResource } from './managed-resource-context.js'

type UploadInput = { fileName: string; content: Buffer }
const mimeByExtension: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf' }

async function validateUpload(input: UploadInput): Promise<{ bytes: Buffer; extension: string; mimeType: string; width: number | null; height: number | null }> {
  const maximum = resourceLimit('MEDIA_MAX_BYTES', 20 * 1024 * 1024)
  if (!input.content.length || input.content.length > maximum) throw new ContentError('VALIDATION_FAILED', { reason: '媒体大小超过限制或内容为空' })
  const extension = path.posix.extname(input.fileName).toLowerCase()
  if (!(allowedMediaExtensions as readonly string[]).includes(extension)) throw new ContentError('VALIDATION_FAILED', { reason: '媒体类型不受支持' })
  let bytes = input.content
  const mimeType = mimeByExtension[extension]
  if (extension === '.svg') {
    const dom = new JSDOM('<!doctype html><html><body></body></html>')
    try {
      const parsed = new dom.window.DOMParser().parseFromString(bytes.toString('utf8'), 'image/svg+xml')
      if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new ContentError('VALIDATION_FAILED', { reason: 'SVG内容无效' })
      const purifier = createDOMPurify(dom.window)
      bytes = Buffer.from(purifier.sanitize(bytes.toString('utf8'), { USE_PROFILES: { svg: true, svgFilters: true } }))
    } finally { dom.window.close() }
  } else {
    let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>
    try { detected = await fileTypeFromBuffer(bytes) }
    catch { throw new ContentError('VALIDATION_FAILED', { reason: '媒体内容无法读取' }) }
    if (detected?.mime !== mimeType) throw new ContentError('VALIDATION_FAILED', { reason: '媒体扩展名与实际类型不一致' })
  }
  if (mimeType.startsWith('image/')) {
    let metadata: Metadata
    try { metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata() }
    catch { throw new ContentError('VALIDATION_FAILED', { reason: '图片内容无法读取' }) }
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) throw new ContentError('VALIDATION_FAILED', { reason: '图片宽高无效' })
    return { bytes, extension, mimeType, width: metadata.width, height: metadata.height }
  }
  return { bytes, extension, mimeType, width: null, height: null }
}

async function readMediaUnlocked(context: ContentContext, mediaId: string): Promise<{ media: MediaMeta; revision: string }> {
  const bytes = await readResource(context, `source/media/${resourceId(mediaId)}.json`)
  if (!bytes) throw new ContentError('NOT_FOUND')
  const media = JSON.parse(bytes.toString('utf8')) as MediaMeta
  assertValidSchema('media', media, `source/media/${mediaId}.json`)
  return { media, revision: resourceRevision(bytes) }
}

export async function readMedia(context: ContentContext, mediaId: string): Promise<{ media: MediaMeta; revision: string }> {
  return withContentTransaction(context, false, async () => readMediaUnlocked(context, mediaId))
}

export async function uploadMedia(context: ContentContext, input: UploadInput, existing?: { mediaId: string; revision: string }): Promise<{ media: MediaMeta; revision: string }> {
  const validated = await validateUpload(input)
  return withContentTransaction(context, true, async (client, backups) => {
    const current = existing ? await readMediaUnlocked(context, existing.mediaId) : null
    if (existing && current!.revision !== existing.revision) throw new ContentError('REVISION_CONFLICT', { currentRevision: current!.revision })
    const mediaId = current?.media.mediaId ?? randomUUID()
    const now = new Date(Math.max(Date.now(), current ? new Date(current.media.updatedAt).getTime() + 1 : 0)).toISOString()
    const media: MediaMeta = {
      schemaVersion: 1, mediaId,
      path: current && path.posix.extname(current.media.path) === validated.extension ? current.media.path : `assets/uploads/${now.slice(0, 4)}/${now.slice(5, 7)}/${mediaId}${validated.extension}`,
      mimeType: validated.mimeType, size: validated.bytes.length, width: validated.width, height: validated.height,
      title: current?.media.title ?? {}, alt: current?.media.alt ?? {}, caption: current?.media.caption ?? {},
      uploadedBy: context.userId, uploadedAt: now, updatedAt: current?.media.updatedAt ?? now,
    }
    assertValidSchema('media', media, `source/media/${mediaId}.json`)
    const metadata = Buffer.from(`${JSON.stringify(media, null, 2)}\n`)
    const revision = resourceRevision(metadata)
    await client.query('INSERT INTO media(draft_id,media_id,data,revision) VALUES($1,$2,$3,$4) ON CONFLICT(draft_id,media_id) DO UPDATE SET data=EXCLUDED.data,revision=EXCLUDED.revision', [context.draftId, mediaId, media, revision])
    if (current && current.media.path !== media.path) await writeResource(context, backups, current.media.path, null)
    await writeResource(context, backups, media.path, validated.bytes)
    await writeResource(context, backups, `source/media/${mediaId}.json`, metadata)
    return { media, revision }
  })
}

export async function mediaUsages(context: ContentContext, mediaId: string): Promise<Array<{ path: string; field: string }>> {
  return withContentTransaction(context, false, async () => {
    await readMediaUnlocked(context, mediaId)
    return resourceUsages(context, record => record.mediaId === mediaId || record.iconMediaId === mediaId, [`source/media/${mediaId}.json`])
  })
}

export async function updateMediaMetadata(context: ContentContext, mediaId: string, changes: Record<string, unknown>, revision: string) {
  if (!changes || Array.isArray(changes) || typeof changes !== 'object') throw new ContentError('VALIDATION_FAILED')
  return withContentTransaction(context, true, async (client, backups) => {
    const current = await readMediaUnlocked(context, mediaId)
    if (current.revision !== revision) throw new ContentError('REVISION_CONFLICT', { currentRevision: current.revision })
    if (Object.keys(changes).some(key => !['title', 'alt', 'caption'].includes(key))) throw new ContentError('VALIDATION_FAILED')
    const media = { ...current.media, ...changes, updatedAt: new Date(Math.max(Date.now(), new Date(current.media.updatedAt).getTime() + 1)).toISOString() }
    assertValidSchema('media', media, `source/media/${mediaId}.json`)
    const bytes = Buffer.from(`${JSON.stringify(media, null, 2)}\n`)
    const nextRevision = resourceRevision(bytes)
    await client.query('UPDATE media SET data=$3,revision=$4 WHERE draft_id=$1 AND media_id=$2', [context.draftId, mediaId, media, nextRevision])
    await writeResource(context, backups, `source/media/${mediaId}.json`, bytes)
    return { media, revision: nextRevision }
  })
}

export async function deleteMedia(context: ContentContext, mediaId: string, revision: string): Promise<void> {
  return withContentTransaction(context, true, async (client, backups) => {
    const current = await readMediaUnlocked(context, mediaId)
    if (current.revision !== revision) throw new ContentError('REVISION_CONFLICT', { currentRevision: current.revision })
    const usages = await resourceUsages(context, record => record.mediaId === mediaId || record.iconMediaId === mediaId, [`source/media/${mediaId}.json`])
    if (usages.length) throw new ContentError('RESOURCE_IN_USE', { usages, count: usages.length })
    await client.query('DELETE FROM media WHERE draft_id=$1 AND media_id=$2', [context.draftId, mediaId])
    await writeResource(context, backups, current.media.path, null)
    await writeResource(context, backups, `source/media/${mediaId}.json`, null)
  })
}

export const mediaRoutes = new Hono<{ Variables: AuthVariables }>()
mediaRoutes.use('/drafts/:draftId/media', requireAuth)
mediaRoutes.use('/drafts/:draftId/media/*', requireAuth)
mediaRoutes.get('/drafts/:draftId/media', async c => {
  try {
    const context = await managedResourceContext(c)
    const rows = await withContentTransaction(context, false, client => client.query('SELECT data,revision FROM media WHERE draft_id=$1 ORDER BY media_id', [context.draftId]))
    return c.json({ media: rows.rows.map(row => ({ media: row.data, revision: row.revision })) })
  } catch (error) { return resourceErrorResponse(error, c) }
})
for (const replace of [false, true]) {
  mediaRoutes.post(replace ? '/drafts/:draftId/media/:mediaId/replace' : '/drafts/:draftId/media', bodyLimit({ maxSize: resourceLimit('MEDIA_MAX_BYTES', 20 * 1024 * 1024) + 64 * 1024 }), async c => {
    try {
      const context = await managedResourceContext(c)
      const body = await c.req.parseBody()
      if (!(body.file instanceof File)) throw new ContentError('VALIDATION_FAILED', { field: 'file' })
      return c.json(await uploadMedia(context, { fileName: body.file.name, content: Buffer.from(await body.file.arrayBuffer()) }, replace ? { mediaId: c.req.param('mediaId')!, revision: expectedRevision(c) } : undefined), replace ? 200 : 201)
    } catch (error) { return resourceErrorResponse(error, c) }
  })
}
mediaRoutes.get('/drafts/:draftId/media/:mediaId', async c => {
  try { return c.json(await readMedia(await managedResourceContext(c), c.req.param('mediaId'))) }
  catch (error) { return resourceErrorResponse(error, c) }
})
mediaRoutes.get('/drafts/:draftId/media/:mediaId/usages', async c => {
  try { return c.json({ usages: await mediaUsages(await managedResourceContext(c), c.req.param('mediaId')) }) }
  catch (error) { return resourceErrorResponse(error, c) }
})
mediaRoutes.put('/drafts/:draftId/media/:mediaId', async c => {
  try { return c.json(await updateMediaMetadata(await managedResourceContext(c), c.req.param('mediaId'), await c.req.json(), expectedRevision(c))) }
  catch (error) { return resourceErrorResponse(error, c) }
})
mediaRoutes.delete('/drafts/:draftId/media/:mediaId', async c => {
  try { await deleteMedia(await managedResourceContext(c), c.req.param('mediaId'), expectedRevision(c)); return c.body(null, 204) }
  catch (error) { return resourceErrorResponse(error, c) }
})
mediaRoutes.get('/drafts/:draftId/media/:mediaId/file', async c => {
  try {
    const context = await managedResourceContext(c)
    const { media } = await readMedia(context, c.req.param('mediaId'))
    const bytes = await context.workspace.readFile(media.path)
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': media.mimeType, 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) { return resourceErrorResponse(error, c) }
})

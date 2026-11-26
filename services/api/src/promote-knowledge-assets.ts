import path from 'node:path'
import { ContentError, type ContentContext, type ManagedContent } from './content-sandbox.js'
import {
  fetchKnowledgeAssetFileFromService,
  KnowledgeImportProxyError,
} from './knowledge-service-client.js'
import { uploadMedia } from './media-routes.js'

function isAssetRef(value: unknown): value is { assetId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === 'assetId' && typeof (value as { assetId: unknown }).assetId === 'string'
}

function collectAssetIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const child of value) collectAssetIds(child, into)
    return
  }
  if (!value || typeof value !== 'object') return
  if (isAssetRef(value)) {
    into.add(value.assetId)
    return
  }
  for (const child of Object.values(value as Record<string, unknown>)) collectAssetIds(child, into)
}

function replaceAssetRefs(value: unknown, mediaByAsset: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => replaceAssetRefs(child, mediaByAsset))
  }
  if (!value || typeof value !== 'object') return value
  if (isAssetRef(value)) {
    const mediaId = mediaByAsset.get(value.assetId)
    if (!mediaId) throw new ContentError('NOT_FOUND', { assetId: value.assetId })
    return { mediaId }
  }
  const record = value as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) {
    next[key] = replaceAssetRefs(child, mediaByAsset)
  }
  return next
}

async function resolveMediaIdForAsset(
  context: ContentContext,
  siteId: string,
  assetId: string,
): Promise<string> {
  const row = await context.database.query(
    `SELECT a.promoted_media, a.source_path
     FROM knowledge_assets a
     JOIN knowledge_bases k USING (kb_id)
     WHERE k.site_id = $1 AND a.asset_id = $2`,
    [siteId, assetId],
  )
  if (!row.rowCount) throw new ContentError('NOT_FOUND', { assetId })

  const promoted = (row.rows[0].promoted_media ?? {}) as Record<string, unknown>
  const existing = promoted[context.draftId]
  if (typeof existing === 'string' && existing.length > 0) {
    return existing
  }

  let file
  try {
    file = await fetchKnowledgeAssetFileFromService(siteId, assetId)
  } catch (error) {
    if (error instanceof KnowledgeImportProxyError && error.status === 404) {
      throw new ContentError('NOT_FOUND', { assetId })
    }
    throw error
  }

  const sourcePath = String(row.rows[0].source_path ?? '')
  const fileName =
    file.fileName && file.fileName !== `${assetId}.bin`
      ? file.fileName
      : path.posix.basename(sourcePath.split('\\').join('/')) || file.fileName

  const uploaded = await uploadMedia(context, {
    fileName,
    content: file.bytes,
  })

  await context.database.query(
    `UPDATE knowledge_assets AS a
     SET promoted_media = jsonb_set(
       COALESCE(a.promoted_media, '{}'::jsonb),
       ARRAY[$3::text],
       to_jsonb($4::text),
       true
     ),
     updated_at = NOW()
     FROM knowledge_bases AS k
     WHERE a.kb_id = k.kb_id AND k.site_id = $1 AND a.asset_id = $2`,
    [siteId, assetId, context.draftId, uploaded.media.mediaId],
  )

  return uploaded.media.mediaId
}

/** 将指定知识库素材提升为草稿 mediaId，并写入 promoted_media 投影。 */
export async function promoteKnowledgeAssetIds(
  context: ContentContext,
  siteId: string,
  assetIds: Iterable<string>,
): Promise<Map<string, string>> {
  const mediaByAsset = new Map<string, string>()
  for (const assetId of assetIds) {
    mediaByAsset.set(assetId, await resolveMediaIdForAsset(context, siteId, assetId))
  }
  return mediaByAsset
}

/** 将生成内容中的 { assetId } 提升为草稿素材库 { mediaId }，并写入 promoted_media 投影。 */
export async function promoteKnowledgeAssets(
  context: ContentContext,
  siteId: string,
  content: ManagedContent,
): Promise<ManagedContent> {
  const cloned = structuredClone(content)
  const assetIds = new Set<string>()
  collectAssetIds(cloned, assetIds)
  if (!assetIds.size) return cloned

  const mediaByAsset = await promoteKnowledgeAssetIds(context, siteId, assetIds)
  return replaceAssetRefs(cloned, mediaByAsset) as ManagedContent
}

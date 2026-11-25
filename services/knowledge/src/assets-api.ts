import path from 'node:path'
import { readAssetMeta, writeAssetMeta } from './asset-meta.js'
import { assetMetaToListItem, listProjectAssets, rebuildAssetsCatalogMarkdown } from './assets-catalog.js'
import { parseKnowledgeAssetRole } from './asset-role.js'
import { readProjectReviews, resolveProjectReview, type ReviewRecord } from './project-reviews.js'
import { KnowledgeProjectionError, projectKnowledgeAsset } from './projection-sync.js'
import { assertLegalSiteId } from './site-id.js'
import type { KnowledgeServiceConfig } from './types.js'

function resolveProjectDir(knowledgeRoot: string, siteId: string): string {
  assertLegalSiteId(siteId)
  const root = path.resolve(knowledgeRoot)
  const projectDir = path.resolve(root, siteId)
  const relative = path.relative(root, projectDir)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`siteId escapes knowledge root: ${siteId}`)
  }
  return projectDir
}

export class AssetsApiError extends Error {
  readonly code: 'invalid_role' | 'invalid_status' | 'asset_not_found' | 'asset_patch_bad_request'

  constructor(code: AssetsApiError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export async function handleListAssets(
  knowledgeRoot: string,
  siteId: string,
  roleQuery: string | undefined,
): Promise<{ assets: Awaited<ReturnType<typeof listProjectAssets>> }> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  let roleFilter: ReturnType<typeof parseKnowledgeAssetRole> | undefined
  if (roleQuery !== undefined && roleQuery.trim() !== '') {
    roleFilter = parseKnowledgeAssetRole(roleQuery.trim())
    if (!roleFilter) {
      throw new AssetsApiError('invalid_role', `invalid role filter: ${roleQuery}`)
    }
  }
  const assets = await listProjectAssets(projectDir, roleFilter ?? undefined)
  return { assets }
}

export async function handleListReviews(
  knowledgeRoot: string,
  siteId: string,
  statusQuery: string | undefined,
): Promise<{ reviews: ReviewRecord[] }> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  let reviews = await readProjectReviews(projectDir)
  if (statusQuery !== undefined && statusQuery.trim() !== '') {
    const status = statusQuery.trim()
    if (status !== 'open' && status !== 'resolved') {
      throw new AssetsApiError('invalid_status', `invalid review status filter: ${statusQuery}`)
    }
    reviews = reviews.filter((item) => item.status === status)
  }
  return { reviews }
}

export async function handleResolveReview(
  knowledgeRoot: string,
  siteId: string,
  reviewId: string,
): Promise<{ review: ReviewRecord }> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  const review = await resolveProjectReview(projectDir, reviewId)
  return { review }
}

export type PatchAssetBody = {
  role?: unknown
  caption?: unknown
  roleReason?: unknown
}

export async function handlePatchAsset(
  config: Pick<KnowledgeServiceConfig, 'knowledgeRoot' | 'databaseUrl'>,
  siteId: string,
  assetId: string,
  body: PatchAssetBody,
): Promise<{ asset: ReturnType<typeof assetMetaToListItem> }> {
  const projectDir = resolveProjectDir(config.knowledgeRoot, siteId)
  const hasRole = body.role !== undefined
  const hasCaption = body.caption !== undefined
  const hasReason = body.roleReason !== undefined
  if (!hasRole && !hasCaption && !hasReason) {
    throw new AssetsApiError('asset_patch_bad_request', 'PATCH body 至少包含 role、caption 或 roleReason 之一')
  }

  let meta
  try {
    meta = await readAssetMeta(projectDir, assetId)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      throw new AssetsApiError('asset_not_found', `asset not found: ${assetId}`)
    }
    throw err
  }

  if (hasRole) {
    if (typeof body.role !== 'string') {
      throw new AssetsApiError('invalid_role', 'role 必须是字符串')
    }
    const role = parseKnowledgeAssetRole(body.role)
    if (!role) {
      throw new AssetsApiError('invalid_role', `invalid role: ${String(body.role)}`)
    }
    meta.role = role
    meta.roleConfidence = 1
    if (!hasReason) {
      meta.roleReason = 'admin_manual'
    }
  }

  if (hasCaption) {
    if (typeof body.caption !== 'string') {
      throw new AssetsApiError('asset_patch_bad_request', 'caption 必须是字符串')
    }
    meta.caption = body.caption
  }

  if (hasReason) {
    if (typeof body.roleReason !== 'string') {
      throw new AssetsApiError('asset_patch_bad_request', 'roleReason 必须是字符串')
    }
    meta.roleReason = body.roleReason
  }

  await writeAssetMeta(projectDir, meta)
  await rebuildAssetsCatalogMarkdown(projectDir)

  if (config.databaseUrl?.trim()) {
    try {
      await projectKnowledgeAsset({
        knowledgeRoot: config.knowledgeRoot,
        databaseUrl: config.databaseUrl,
        siteId,
        assetId,
      })
    } catch (err) {
      if (err instanceof KnowledgeProjectionError) {
        throw err
      }
      throw err
    }
  }

  return { asset: assetMetaToListItem(meta) }
}

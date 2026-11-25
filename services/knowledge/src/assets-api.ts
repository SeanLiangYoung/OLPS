import path from 'node:path'
import { listProjectAssets } from './assets-catalog.js'
import { parseKnowledgeAssetRole } from './asset-role.js'
import { readProjectReviews } from './project-reviews.js'
import { assertLegalSiteId } from './site-id.js'

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
  readonly code: 'invalid_role'

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

export async function handleListReviews(knowledgeRoot: string, siteId: string): Promise<{ reviews: unknown[] }> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  const reviews = await readProjectReviews(projectDir)
  return { reviews }
}
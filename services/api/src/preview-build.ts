import fs from 'node:fs/promises'
import path from 'node:path'
import { computeBuildPlan, listPublicRoutes, type LoadedWorkspace, type PublishConfig } from '@olps/site-builder'
import type { SyncWorkspace } from '@olps/sync'
import { appConfig } from './config.js'
import { PREVIEW_PUBLISH_SITE_SEGMENT } from './preview-constants.js'
import { planPreviewAssetFiles } from './preview-asset-plan.js'
import { rewritePreviewPlanHtml } from './preview-html-rewrites.js'
import { readSiteSettingsFromWorkspace } from './workspace-factory.js'
import { PUBLISH_CONFIG_PATH } from './workspace-bootstrap.js'
import type { StoredPageJson } from './page-sandbox.js'

export { PREVIEW_PUBLISH_SITE_SEGMENT } from './preview-constants.js'

async function readPublishConfig(workspace: SyncWorkspace): Promise<PublishConfig> {
  let raw: Buffer
  try {
    raw = await workspace.readFile(PUBLISH_CONFIG_PATH)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const message = err instanceof Error ? err.message : String(err)
    if (code === 'ENOENT' || message.includes('ENOENT')) {
      throw new Error('PREVIEW_PUBLISH_CONFIG_MISSING')
    }
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error('PREVIEW_PUBLISH_CONFIG_INVALID')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PREVIEW_PUBLISH_CONFIG_INVALID')
  }
  return parsed as PublishConfig
}

export async function buildPreviewArtifacts(input: {
  workspace: SyncWorkspace
  pageJson: StoredPageJson
  rawToken: string
  draftId: string
}): Promise<{ entryRelativePath: string; files: Array<{ relativePath: string; content: Buffer }> }> {
  const settings = await readSiteSettingsFromWorkspace(input.workspace)
  const publishBase = await readPublishConfig(input.workspace)
  const publicApiBaseUrl = appConfig.publicApiBaseUrl
  const publishConfig: PublishConfig = {
    ...publishBase,
    publicApiBaseUrl,
    siteId: publishBase.siteId ?? input.draftId,
    publicSiteUrl: `${publicApiBaseUrl}/preview-access/${input.rawToken}`,
  }

  const loaded: LoadedWorkspace = {
    settings: { ...settings, analyticsEnabled: false },
    publishConfig,
    pages: [{ ...input.pageJson, status: 'draft' }],
  }

  const htmlPlans = computeBuildPlan(loaded)
  const workspacePath = input.workspace.getState().workspacePath
  const assetPlans = await planPreviewAssetFiles(workspacePath)

  const entryRoute = listPublicRoutes(loaded.pages, publishConfig)[0]
  if (!entryRoute) throw new Error('PREVIEW_BUILD_FAILED')
  const entryRelativePath = `${entryRoute.routeSlug}/index.html`
  const entryPlan = htmlPlans.find((plan) => plan.relativePath === entryRelativePath)
  if (!entryPlan) {
    throw new Error('PREVIEW_BUILD_FAILED')
  }

  const files: Array<{ relativePath: string; content: Buffer }> = []
  for (const plan of htmlPlans) {
    if (plan.relativePath === 'index.html' || plan.relativePath === 'sitemap.xml') {
      continue
    }
    if (plan.relativePath === entryRelativePath) {
      continue
    }
    const rewritten = rewritePreviewPlanHtml(plan.content, input.rawToken)
    files.push({ relativePath: plan.relativePath, content: Buffer.from(rewritten, 'utf8') })
  }

  for (const asset of assetPlans) {
    files.push(asset)
  }

  files.push({
    relativePath: entryRelativePath,
    content: Buffer.from(rewritePreviewPlanHtml(entryPlan.content, input.rawToken), 'utf8'),
  })

  return { entryRelativePath, files }
}

export async function writePreviewArtifactTree(
  capabilityId: string,
  files: Array<{ relativePath: string; content: Buffer }>,
): Promise<void> {
  const root = path.join(appConfig.previewRoot, 'capabilities', capabilityId)
  await fs.rm(root, { recursive: true, force: true })
  for (const file of files) {
    const rel = file.relativePath.replace(/\\/g, '/')
    if (rel.split('/').some((part) => part === '..' || part === '')) {
      throw new Error(`预览产物路径不安全: ${rel}`)
    }
    const dest = path.join(root, rel)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, file.content)
  }
}

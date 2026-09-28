import fs from 'node:fs/promises'
import path from 'node:path'
import { computeBuildPlan, type LoadedWorkspace, type PublishConfig } from '@olps/site-builder'
import type { SyncWorkspace } from '@olps/sync'
import { appConfig } from './config.js'
import { planPreviewAssetFiles } from './preview-asset-plan.js'
import { readSiteSettingsFromWorkspace } from './workspace-factory.js'
import { PUBLISH_CONFIG_PATH } from './workspace-bootstrap.js'
import type { StoredPageJson } from './page-sandbox.js'

export const PREVIEW_PUBLISH_SITE_SEGMENT = 'pv'

function slugifyKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function rewritePreviewHtmlPaths(html: string, rawToken: string): string {
  const prefix = `/s/${PREVIEW_PUBLISH_SITE_SEGMENT}/`
  const mounted = `/preview-access/${rawToken}${prefix}`
  return html.replaceAll(prefix, mounted)
}

function previewEntryRelativePath(pageJson: StoredPageJson): string {
  if (pageJson.kind === 'ads' && pageJson.body.ads) {
    const keyword = pageJson.body.ads.keywordCluster[0]
    if (!keyword) {
      throw new Error('PREVIEW_BUILD_FAILED')
    }
    return `${pageJson.slug}--${slugifyKeyword(keyword)}/index.html`
  }
  return `${pageJson.slug}/index.html`
}

async function readPublishConfig(workspace: SyncWorkspace): Promise<PublishConfig> {
  try {
    const raw = await workspace.readFile(PUBLISH_CONFIG_PATH)
    return JSON.parse(raw.toString('utf8')) as PublishConfig
  } catch {
    return {}
  }
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
    publicSiteUrl: `${publicApiBaseUrl}/preview-access/${input.rawToken}/s/${PREVIEW_PUBLISH_SITE_SEGMENT}`,
  }

  const loaded: LoadedWorkspace = {
    settings,
    publishConfig,
    pages: [input.pageJson],
  }

  const htmlPlans = computeBuildPlan(loaded)
  const workspacePath = input.workspace.getState().workspacePath
  const assetPlans = await planPreviewAssetFiles(workspacePath)

  const entryRelativePath = previewEntryRelativePath(input.pageJson)
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
    const rewritten = rewritePreviewHtmlPaths(plan.content, input.rawToken)
    files.push({ relativePath: plan.relativePath, content: Buffer.from(rewritten, 'utf8') })
  }

  for (const asset of assetPlans) {
    files.push(asset)
  }

  files.push({
    relativePath: entryRelativePath,
    content: Buffer.from(rewritePreviewHtmlPaths(entryPlan.content, input.rawToken), 'utf8'),
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

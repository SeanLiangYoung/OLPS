import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { SITE_PATHS, SyncWorkspace } from '@olps/sync'
import type { SiteSettings } from '@olps/domain'
import { appConfig } from './config.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import {
  bootstrapNewDraftWorkspace,
  writePublishConfigToWorkspace,
} from './workspace-bootstrap.js'
import { readSiteSettingsFromWorkspace, writeSiteSettingsToWorkspace } from './workspace-factory.js'
import { readPageFromWorkspace, writePageToWorkspace, type StoredPageJson } from './page-sandbox.js'

export const MIGRATION_LEGACY_INPUT_FINGERPRINT_PATH = '.olps/migration-legacy-input-fingerprint.txt'

export function stableDraftIdForLegacySite(legacySiteId: string): string {
  const digest = createHash('sha256').update(`olps:migrate:site:${legacySiteId}`, 'utf8').digest('hex')
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
}

export type LegacyPageRow = {
  page_id: string
  site_id: string
  kind: string
  slug: string
  title: string
  status: string
  locale: string
  seo: unknown
  body: unknown
  created_at: Date
  updated_at: Date
  published_at: Date | null
}

function legacyPageFingerprintPart(pageRow: LegacyPageRow): Record<string, unknown> {
  return {
    pageId: String(pageRow.page_id),
    kind: String(pageRow.kind),
    slug: String(pageRow.slug),
    title: String(pageRow.title),
    status: String(pageRow.status),
    locale: String(pageRow.locale),
    seo: pageRow.seo,
    body: pageRow.body,
    publishedAt: pageRow.published_at
      ? new Date(pageRow.published_at).toISOString()
      : null,
  }
}

export function computeLegacySiteInputFingerprint(input: {
  legacySiteId: string
  settings: SiteSettings
  pages: LegacyPageRow[]
}): string {
  const pages = [...input.pages]
    .map((pageRow) => legacyPageFingerprintPart(pageRow))
    .sort((a, b) => String(a.pageId).localeCompare(String(b.pageId)))
  const payload = {
    legacySiteId: input.legacySiteId,
    settings: input.settings,
    pages,
  }
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
}

function storedPageMatchesLegacyRow(json: StoredPageJson, pageRow: LegacyPageRow): boolean {
  const expectedPublished = pageRow.published_at
    ? new Date(pageRow.published_at).toISOString()
    : null
  const actualPublished =
    json.publishedAt === undefined || json.publishedAt === null
      ? null
      : new Date(json.publishedAt).toISOString()
  return (
    String(json.pageId) === String(pageRow.page_id) &&
    String(json.kind) === String(pageRow.kind) &&
    String(json.slug) === String(pageRow.slug) &&
    String(json.title) === String(pageRow.title) &&
    String(json.status) === String(pageRow.status) &&
    String(json.locale) === String(pageRow.locale) &&
    JSON.stringify(json.seo) === JSON.stringify(pageRow.seo) &&
    JSON.stringify(json.body) === JSON.stringify(pageRow.body) &&
    actualPublished === expectedPublished
  )
}

export async function legacyDraftSandboxExists(sandboxId: string): Promise<boolean> {
  const workspacePath = `${appConfig.sandboxRoot}/${sandboxId}`
  try {
    await fs.access(`${workspacePath}/.git`)
    return true
  } catch {
    return false
  }
}

async function writeLegacyInputFingerprint(
  workspace: SyncWorkspace,
  fingerprint: string,
): Promise<void> {
  await workspace.writeFile(
    MIGRATION_LEGACY_INPUT_FINGERPRINT_PATH,
    Buffer.from(`${fingerprint}\n`, 'utf8'),
  )
}

async function assertExistingSandboxMatchesLegacyInput(input: {
  legacySiteId: string
  draftId: string
  sandboxId: string
  settings: SiteSettings
  pages: LegacyPageRow[]
}): Promise<{ headCommitId: string; baseCommitId: string | null }> {
  const workspace = await SyncWorkspace.open({
    sandboxRoot: appConfig.sandboxRoot,
    draftId: input.sandboxId,
    remote: requireRemoteServiceConfig(),
    remoteSiteId: null,
    baseCommitId: null,
    headCommitId: null,
  })

  const expectedFingerprint = computeLegacySiteInputFingerprint({
    legacySiteId: input.legacySiteId,
    settings: input.settings,
    pages: input.pages,
  })

  let storedFingerprint = ''
  try {
    storedFingerprint = (await workspace.readFile(MIGRATION_LEGACY_INPUT_FINGERPRINT_PATH))
      .toString('utf8')
      .trim()
  } catch {
    throw new Error('迁移 sandbox 与 legacy 输入不一致: 缺少输入指纹')
  }
  if (storedFingerprint !== expectedFingerprint) {
    throw new Error('迁移 sandbox 与 legacy 输入不一致: 输入指纹不匹配')
  }

  const workspaceSettings = await readSiteSettingsFromWorkspace(workspace)
  if (JSON.stringify(workspaceSettings) !== JSON.stringify(input.settings)) {
    throw new Error('迁移 sandbox 与 legacy 输入不一致: site settings 不匹配')
  }

  const expectedPageIds = new Set(input.pages.map((pageRow) => String(pageRow.page_id)))
  const workspacePageFiles = await workspace.listFiles(SITE_PATHS.pagesDir)
  const workspacePageIds = new Set<string>()
  for (const rel of workspacePageFiles) {
    if (!rel.endsWith('.json')) {
      continue
    }
    const pageId = rel.split('/').pop()!.replace(/\.json$/, '')
    workspacePageIds.add(pageId)
  }
  for (const pageId of expectedPageIds) {
    if (!workspacePageIds.has(pageId)) {
      throw new Error(`迁移 sandbox 与 legacy 输入不一致: 缺少页面 ${pageId}`)
    }
  }
  for (const pageId of workspacePageIds) {
    if (!expectedPageIds.has(pageId)) {
      throw new Error(`迁移 sandbox 与 legacy 输入不一致: 多余页面 ${pageId}`)
    }
  }

  for (const pageRow of input.pages) {
    const pageId = String(pageRow.page_id)
    const json = await readPageFromWorkspace(workspace, pageId)
    if (!json) {
      throw new Error(`迁移 sandbox 与 legacy 输入不一致: 缺少页面 ${pageId}`)
    }
    if (!storedPageMatchesLegacyRow(json, pageRow)) {
      throw new Error(`迁移 sandbox 与 legacy 输入不一致: 页面 ${pageId} 内容不匹配`)
    }
  }

  const manifestRaw = await workspace.readFile(SITE_PATHS.manifest)
  if (!manifestRaw.length) {
    throw new Error('迁移 sandbox 缺少 olps.manifest.json')
  }

  const state = workspace.getState()
  if (state.status !== 'clean') {
    throw new Error('迁移 sandbox 与 legacy 输入不一致: Git 工作区未处于 clean 状态')
  }

  const validation = await workspace.runValidation()
  if (!validation.ok) {
    throw new Error(`迁移 sandbox 校验失败: ${validation.log}`)
  }

  if (!state.headCommitId) {
    throw new Error('迁移 sandbox 缺少 headCommitId')
  }
  return { headCommitId: state.headCommitId, baseCommitId: state.baseCommitId }
}

export async function initializeLegacySiteSandbox(input: {
  legacySiteId: string
  draftId: string
  sandboxId: string
  pendingSiteId: string
  siteName: string
  settings: SiteSettings
  pages: LegacyPageRow[]
  skipIfPresent: boolean
}): Promise<{ headCommitId: string; baseCommitId: string | null }> {
  if (input.skipIfPresent && (await legacyDraftSandboxExists(input.sandboxId))) {
    return assertExistingSandboxMatchesLegacyInput({
      legacySiteId: input.legacySiteId,
      draftId: input.draftId,
      sandboxId: input.sandboxId,
      settings: input.settings,
      pages: input.pages,
    })
  }

  const workspace = await SyncWorkspace.create({
    sandboxRoot: appConfig.sandboxRoot,
    draftId: input.sandboxId,
    remote: requireRemoteServiceConfig(),
    remoteSiteId: null,
    baseCommitId: null,
  })
  await bootstrapNewDraftWorkspace(workspace, {
    pendingSiteId: input.pendingSiteId,
    publicSiteUrl: null,
  })
  await writeSiteSettingsToWorkspace(workspace, input.settings)
  await writePublishConfigToWorkspace(workspace, {
    siteId: input.pendingSiteId,
    publicApiBaseUrl: appConfig.publicApiBaseUrl,
  })
  for (const pageRow of input.pages) {
    const json: StoredPageJson = {
      pageId: String(pageRow.page_id),
      kind: pageRow.kind as StoredPageJson['kind'],
      slug: String(pageRow.slug),
      title: String(pageRow.title),
      status: pageRow.status as StoredPageJson['status'],
      locale: String(pageRow.locale),
      seo: pageRow.seo as StoredPageJson['seo'],
      body: pageRow.body as StoredPageJson['body'],
      publishedAt: pageRow.published_at ? new Date(pageRow.published_at).toISOString() : null,
    }
    await writePageToWorkspace(workspace, json)
  }
  await workspace.saveVersion(`api: migrate legacy site ${input.legacySiteId}`)
  const validation = await workspace.runValidation()
  if (!validation.ok) {
    throw new Error(`迁移 sandbox 构建失败: ${validation.log}`)
  }
  const dirty = workspace.getState().status === 'dirty'
  if (dirty) {
    await workspace.saveVersion('api: migrate legacy public output')
  }

  const fingerprint = computeLegacySiteInputFingerprint({
    legacySiteId: input.legacySiteId,
    settings: input.settings,
    pages: input.pages,
  })
  await writeLegacyInputFingerprint(workspace, fingerprint)
  if (workspace.getState().status !== 'clean') {
    await workspace.saveVersion('api: migrate legacy input fingerprint')
  }

  const state = workspace.getState()
  const manifestRaw = await workspace.readFile(SITE_PATHS.manifest)
  if (!manifestRaw.length) {
    throw new Error('迁移 sandbox 缺少 olps.manifest.json')
  }
  if (!state.headCommitId) {
    throw new Error('迁移 sandbox 缺少 headCommitId')
  }
  return { headCommitId: state.headCommitId, baseCommitId: state.baseCommitId }
}

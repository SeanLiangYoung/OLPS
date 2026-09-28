import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { verifySite } from '@olps/site-builder'
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
export const MIGRATION_CERTIFIED_HEAD_GIT_REF = 'refs/olps/migration-certified-head'

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

function gitOrThrow(workspacePath: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: workspacePath,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) {
    throw result.error
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`git ${args.join(' ')} 失败 (${result.status}): ${result.stderr || result.stdout}`)
  }
  return (result.stdout ?? '').trim()
}

function gitRefExists(workspacePath: string, ref: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--verify', ref], {
    cwd: workspacePath,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })
  return (result.status ?? 1) === 0
}

function readMigrationCertifiedHeadRef(workspacePath: string): string | null {
  if (!gitRefExists(workspacePath, MIGRATION_CERTIFIED_HEAD_GIT_REF)) {
    return null
  }
  return gitOrThrow(workspacePath, ['rev-parse', MIGRATION_CERTIFIED_HEAD_GIT_REF])
}

function setMigrationCertifiedHeadRef(workspacePath: string, headCommitId: string): void {
  if (!/^[0-9a-f]{40}$/.test(headCommitId)) {
    throw new Error(`迁移 sandbox 认证 ref 非法 commit: ${headCommitId}`)
  }
  gitOrThrow(workspacePath, ['update-ref', MIGRATION_CERTIFIED_HEAD_GIT_REF, headCommitId])
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

function sandboxWorkspacePath(sandboxId: string): string {
  return path.join(appConfig.sandboxRoot, sandboxId)
}

async function assertSandboxPublicMatchesSourceWithoutBuild(sandboxId: string): Promise<void> {
  await verifySite(sandboxWorkspacePath(sandboxId))
}

function assertCertifiedHeadMatchesCurrentHead(
  workspacePath: string,
  currentHeadCommitId: string,
): void {
  const certifiedHead = readMigrationCertifiedHeadRef(workspacePath)
  if (!certifiedHead) {
    throw new Error('迁移 sandbox 未完成认证: 缺少 refs/olps/migration-certified-head')
  }
  if (!/^[0-9a-f]{40}$/.test(certifiedHead)) {
    throw new Error('迁移 sandbox 未完成认证: 认证 ref 无效')
  }
  if (certifiedHead !== currentHeadCommitId) {
    throw new Error('迁移 sandbox 与 legacy 输入不一致: 用户已修改 sandbox 版本')
  }
}

function finalizeMigrationSandboxCertification(
  workspace: SyncWorkspace,
  sandboxId: string,
): { headCommitId: string; baseCommitId: string | null } {
  const workspacePath = sandboxWorkspacePath(sandboxId)
  const state = workspace.getState()
  if (state.status !== 'clean') {
    throw new Error('迁移 sandbox 构建失败: 认证前工作区未 clean')
  }
  if (!state.headCommitId) {
    throw new Error('迁移 sandbox 缺少 headCommitId')
  }
  setMigrationCertifiedHeadRef(workspacePath, state.headCommitId)
  const certified = readMigrationCertifiedHeadRef(workspacePath)
  if (certified !== state.headCommitId) {
    throw new Error('迁移 sandbox 构建失败: 认证 ref 与 HEAD 不一致')
  }
  return { headCommitId: state.headCommitId, baseCommitId: state.baseCommitId }
}

async function assertExistingSandboxMatchesLegacyInput(input: {
  legacySiteId: string
  draftId: string
  sandboxId: string
  settings: SiteSettings
  pages: LegacyPageRow[]
}): Promise<{ headCommitId: string; baseCommitId: string | null }> {
  const workspacePath = sandboxWorkspacePath(input.sandboxId)
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
  if (!storedFingerprint) {
    throw new Error('迁移 sandbox 与 legacy 输入不一致: 输入指纹为空')
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

  let state = workspace.getState()
  if (state.status !== 'clean') {
    throw new Error('迁移 sandbox 与 legacy 输入不一致: Git 工作区未处于 clean 状态')
  }
  if (!state.headCommitId) {
    throw new Error('迁移 sandbox 与 legacy 输入不一致: 缺少 headCommitId')
  }

  if (!state.headCommitId) {
    throw new Error('迁移 sandbox 缺少 headCommitId')
  }
  assertCertifiedHeadMatchesCurrentHead(workspacePath, state.headCommitId)

  await assertSandboxPublicMatchesSourceWithoutBuild(input.sandboxId)

  state = workspace.getState()
  if (state.status !== 'clean') {
    throw new Error('迁移 sandbox 与 legacy 输入不一致: 校验后 Git 工作区未处于 clean 状态')
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

  const manifestRaw = await workspace.readFile(SITE_PATHS.manifest)
  if (!manifestRaw.length) {
    throw new Error('迁移 sandbox 缺少 olps.manifest.json')
  }
  await assertSandboxPublicMatchesSourceWithoutBuild(input.sandboxId)
  if (workspace.getState().status !== 'clean') {
    throw new Error('迁移 sandbox 构建失败: verifySite 后工作区未 clean')
  }

  const certified = finalizeMigrationSandboxCertification(workspace, input.sandboxId)
  if (!certified.headCommitId) {
    throw new Error('迁移 sandbox 缺少 headCommitId')
  }
  return certified
}

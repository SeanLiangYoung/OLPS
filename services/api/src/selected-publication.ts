import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import type pg from 'pg'
import { SITE_PATHS, SyncWorkspace, pageJsonPath, remoteCreateSite, remoteGetSite, RemotePushError } from '@olps/sync'
import type { SiteSettings } from '@olps/domain'
import { pool } from './db.js'
import { appConfig } from './config.js'
import { canPublishDraft, isDraftOwner } from './permissions.js'
import { listDraftsForUser } from './drafts-service.js'
import { openDraftWorkspace, readSiteSettingsFromWorkspace, writeSiteSettingsToWorkspace } from './workspace-factory.js'
import { readPageFromWorkspace, writePageToWorkspace, type StoredPageJson } from './page-sandbox.js'
import { bootstrapNewDraftWorkspace, ensurePublishConfigForPush, refreshManagedSiteBuilder } from './workspace-bootstrap.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { preparePublicationResources } from './selected-publication-resources.js'
import { withDraftLock } from './draft-lock.js'
import { assertDraftOrdinaryEditAllowed } from './draft-ordinary-edit-guard.js'

export type PublicationIssue = { code: string; message: string; pageId?: string; path?: string }
export type PublicationPage = { pageId: string; title: string; slug: string; kind: string; locale: string; updatedAt: string;
  operation: 'publish' | 'unpublish' | 'delete' | 'none'; onlineStatus: 'published' | 'unpublished'; changed: boolean; issues: PublicationIssue[] }
export type PublicationPreview = { token: string | null; taskId?: string; pages: PublicationPage[]; settingsChanged: boolean;
  issues: PublicationIssue[]; expiresAt: string; baseCommitId: string | null }
type Snapshot = { pages: StoredPageJson[]; selected: PublicationPage[]; selectedPages: Record<string, StoredPageJson | null>;
  settings: SiteSettings; settingsChanged: boolean; draftBaseCommitId: string | null; issues: PublicationIssue[];
  resourceManifest?: { path: string; digest: string }[] }
export class PublicationError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 410 | 422 | 503, readonly issues: PublicationIssue[] = [], readonly taskId?: string) { super(message) }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}
function equal(a: unknown, b: unknown): boolean { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)) }
function comparable(page: StoredPageJson | null): unknown {
  if (!page) return null
  const { translationGroupId: metadataTranslationGroupId, editor: _editor, ...metadata } = page.metadata ?? {}
  return { pageId: page.pageId, kind: page.kind, slug: page.slug, title: page.title, locale: page.locale,
    seo: page.seo, body: page.body, translationGroupId: page.translationGroupId ?? metadataTranslationGroupId ?? null, metadata }
}
function samePage(a: StoredPageJson | null, b: StoredPageJson | null): boolean { return equal(comparable(a), comparable(b)) }
export async function restorePublicationPage(userId: string, draftId: string, pageId: string) {
  return withDraftLock(draftId, async () => {
    const state = await currentState(userId, draftId)
    assertDraftOrdinaryEditAllowed(state.row)
    if (state.current.has(pageId)) throw new PublicationError('页面已经存在，请重新加载', 409)
    const page = state.online.get(pageId)
    if (!page) throw new PublicationError('没有可以恢复的线上页面', 404)
    const workspace = await workspaceFor(state.row)
    const now = new Date().toISOString()
    const restored = { ...page, updatedAt: now }
    const client = await pool.connect()
    let written = false
    try {
      await client.query('BEGIN')
      await client.query(`INSERT INTO pages(page_id,draft_id,site_id,kind,slug,title,status,locale,seo,body,metadata,created_at,updated_at,published_at)
        VALUES($1,$2,$3,$4,$5,$6,'published',$7,$8,$9,$10,$11,$11,$11)`,
      [pageId,draftId,state.site.site_id,page.kind,page.slug,page.title,page.locale,page.seo,page.body,{ ...page.metadata, translationGroupId: page.translationGroupId },now])
      await writePageToWorkspace(workspace, restored)
      written = true
      await client.query(`UPDATE site_drafts SET sync_status='dirty',updated_at=now() WHERE draft_id=$1`, [draftId])
      await client.query('COMMIT')
      return { page: restored }
    } catch (error) {
      await client.query('ROLLBACK')
      if (written) await workspace.deleteFile(pageJsonPath(pageId))
      if ((error as { code?: string }).code === '23505') throw new PublicationError('页面地址已经使用，请修改同地址页面后恢复', 409)
      throw error
    } finally { client.release() }
  })
}
function hash(token: string): string { return createHash('sha256').update(token).digest('hex') }
async function authorized(userId: string, draftId: string, publish = true) {
  if (!(await (publish ? canPublishDraft(userId, draftId) : isDraftOwner(userId, draftId)))) throw new PublicationError('无权访问该网站内容', 403)
  const result = await pool.query(`SELECT * FROM site_drafts WHERE draft_id=$1`, [draftId])
  const row = result.rows[0]!
  if (row.init_status !== 'ready') throw new PublicationError('工作草稿尚未准备完成', 409)
  return row
}
function workspaceFor(row: Record<string, unknown>) {
  return openDraftWorkspace({ draftId: String(row.draft_id), sandboxId: String(row.sandbox_id), siteId: row.site_id as string | null,
    draftRemoteSiteId: row.remote_site_id as string | null, baseCommitId: row.base_commit_id as string | null, headCommitId: row.head_commit_id as string | null })
}
async function attachSite(draftId: string): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const row = (await client.query(`SELECT * FROM site_drafts WHERE draft_id=$1 FOR UPDATE`, [draftId])).rows[0]!
    if (row.site_id) { await client.query('COMMIT'); return String(row.site_id) }
    const siteId = String(row.pending_site_id ?? randomUUID())
    const settings = await readSiteSettingsFromWorkspace(await workspaceFor(row))
    await client.query(`INSERT INTO sites(site_id,name,settings,remote_site_id,created_at,updated_at) VALUES($1,$2,$3,$4,NOW(),NOW())`, [siteId, row.name, settings, row.remote_site_id])
    await client.query(`INSERT INTO site_owners(site_id,user_id,created_at) SELECT $1,user_id,NOW() FROM draft_owners WHERE draft_id=$2`, [siteId, draftId])
    await client.query(`UPDATE site_drafts SET site_id=$2,pending_site_id=$2 WHERE draft_id=$1`, [draftId, siteId])
    await client.query(`UPDATE pages SET site_id=$2 WHERE draft_id=$1`, [draftId, siteId])
    await client.query('COMMIT')
    return siteId
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
export async function listManagedSites(userId: string) {
  const drafts = await listDraftsForUser(userId)
  for (const draft of drafts) if (!draft.siteId && draft.initStatus === 'ready') await attachSite(draft.draftId)
  const updated = await listDraftsForUser(userId)
  const sites = await pool.query(`SELECT s.*,EXISTS(SELECT 1 FROM site_owners o WHERE o.site_id=s.site_id AND o.user_id=$1) AS can_publish FROM sites s
    WHERE EXISTS(SELECT 1 FROM site_owners o WHERE o.site_id=s.site_id AND o.user_id=$1)
      OR EXISTS(SELECT 1 FROM site_drafts d JOIN draft_owners o ON o.draft_id=d.draft_id WHERE d.site_id=s.site_id AND o.user_id=$1)
    ORDER BY s.updated_at DESC`, [userId])
  return sites.rows.map((site) => ({ siteId: String(site.site_id), name: String(site.name), publicUrl: site.public_url as string | null,
    createdAt: new Date(site.created_at).toISOString(), updatedAt: new Date(site.updated_at).toISOString(),
    publishedCommitId: site.published_commit_id as string | null, canPublish: Boolean(site.can_publish), drafts: updated.filter((draft) => draft.siteId === site.site_id) }))
}
function pageAtCommit(workspace: SyncWorkspace, commitId: string | null, pageId: string): StoredPageJson | null {
  if (!commitId) return null
  if (!/^[a-f0-9]{40}$/.test(commitId)) throw new PublicationError('草稿基础版本无效', 409)
  const result = spawnSync('git', ['show', `${commitId}:${pageJsonPath(pageId)}`], { cwd: workspace.getState().workspacePath, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status === 0) return JSON.parse(result.stdout) as StoredPageJson
  const commit = spawnSync('git', ['cat-file', '-e', commitId], { cwd: workspace.getState().workspacePath, encoding: 'utf8' })
  if (commit.status !== 0) throw new PublicationError('无法核对草稿基础版本，请同步网站内容', 409)
  return null
}
async function currentState(userId: string, draftId: string, publish = true) {
  let row = await authorized(userId, draftId, publish)
  const siteId = await attachSite(draftId)
  row = await authorized(userId, draftId, publish)
  const site = (await pool.query(`SELECT * FROM sites WHERE site_id=$1`, [siteId])).rows[0]!
  const workspace = await workspaceFor(row)
  const current = new Map<string, StoredPageJson>()
  for (const file of await workspace.listFiles(SITE_PATHS.pagesDir)) {
    if (!file.endsWith('.json')) continue
    const pageId = file.slice(file.lastIndexOf('/') + 1, -5)
    const page = await readPageFromWorkspace(workspace, pageId)
    if (page) current.set(page.pageId, page)
  }
  const online = new Map<string, StoredPageJson>()
  const published = await pool.query(`SELECT * FROM site_published_pages WHERE site_id=$1`, [siteId])
  for (const page of published.rows) online.set(String(page.page_id), { ...page.source_page as StoredPageJson | undefined, pageId: String(page.page_id), kind: page.kind,
    slug: String(page.slug), title: String(page.title), locale: String(page.locale), seo: page.seo, body: page.body,
    status: 'published', metadata: page.metadata ?? {}, translationGroupId: page.metadata?.translationGroupId })
  const settings = await readSiteSettingsFromWorkspace(workspace)
  const settingsChanged = !site.published_commit_id || !equal(settings, site.settings)
  const settingsIssues: PublicationIssue[] = []
  if (site.published_commit_id && settingsChanged) {
    const recorded = await pool.query(`SELECT snapshot->'settings' AS settings FROM selected_publication_tasks
      WHERE draft_id=$1 AND status='completed' AND snapshot->>'draftBaseCommitId' IS NOT DISTINCT FROM $2
        AND snapshot->>'settingsChanged'='true' ORDER BY updated_at DESC LIMIT 1`, [draftId, row.base_commit_id])
    let baseSettings: unknown = recorded.rows[0]?.settings
    if (!baseSettings && row.base_commit_id) {
      const result = spawnSync('git', ['show', `${row.base_commit_id}:${SITE_PATHS.siteSettings}`], { cwd: workspace.getState().workspacePath, encoding: 'utf8' })
      if (result.status === 0) baseSettings = JSON.parse(result.stdout)
    }
    if (!baseSettings || !equal(baseSettings, site.settings)) settingsIssues.push({ code: 'SETTINGS_VERSION_CONFLICT', message: '线上网站设置已经更新，请同步设置后重新预检' })
  }
  const savedBases = (await pool.query(`SELECT * FROM draft_page_publication_bases WHERE draft_id=$1`, [draftId])).rows
  const pages: PublicationPage[] = []
  for (const pageId of new Set([...current.keys(), ...online.keys()])) {
    const draft = current.get(pageId) ?? null
    const live = online.get(pageId) ?? null
    const next = draft?.status === 'unpublished' ? null : draft
    const changed = !samePage(next, live)
    const operation = !changed ? 'none' : !draft ? 'delete' : draft.status === 'unpublished' ? 'unpublish' : 'publish'
    const saved = savedBases.find((base) => base.page_id === pageId && base.draft_base_commit_id === row.base_commit_id)
    const base = saved ? saved.page as StoredPageJson | null : pageAtCommit(workspace, row.base_commit_id, pageId)
    const issues: PublicationIssue[] = []
    if (changed && !samePage(base?.status === 'unpublished' ? null : base, live)) issues.push({ code: 'PAGE_VERSION_CONFLICT', message: '线上页面已经更新，请同步并处理内容后重新预检', pageId })
    const display = draft ?? live!
    pages.push({ pageId, title: display.title, slug: display.slug, kind: display.kind, locale: display.locale,
      updatedAt: display.updatedAt ?? '', operation, onlineStatus: live ? 'published' : 'unpublished', changed, issues })
  }
  return { row, site, workspace, current, online, settings, pages, settingsChanged, settingsIssues, snapshotComplete: published.rows.every((page) => page.source_page) }
}
export async function getPublication(userId: string, draftId: string) {
  const state = await currentState(userId, draftId, false)
  return { pages: state.pages, settingsChanged: state.settingsChanged, issues: [...state.pages.flatMap((page) => page.issues), ...state.settingsIssues],
    site: { siteId: String(state.site.site_id), name: String(state.site.name), publicUrl: state.site.public_url as string | null, publishedCommitId: state.site.published_commit_id as string | null } }
}

export async function previewPublication(userId: string, draftId: string, input: { pageIds: string[]; includeSettings: boolean }) {
  return withDraftLock(draftId, () => previewPublicationUnlocked(userId, draftId, input))
}
async function previewPublicationUnlocked(userId: string, draftId: string, input: { pageIds: string[]; includeSettings: boolean }): Promise<PublicationPreview> {
  const state = await currentState(userId, draftId)
  const active = await pool.query(`SELECT task_id FROM selected_publication_tasks WHERE site_id=$1 AND status IN ('publishing','reconciling') LIMIT 1`, [state.site.site_id])
  if (active.rowCount) throw new PublicationError('网站存在需要核对的发布任务', 409, [], String(active.rows[0]!.task_id))
  const selectedIds = [...new Set(input.pageIds)]
  const selected = selectedIds.map((pageId) => {
    const page = state.pages.find((item) => item.pageId === pageId)
    if (!page) throw new PublicationError('所选页面不存在', 400)
    return page
  })
  const settingsChanged = input.includeSettings && state.settingsChanged
  if (!state.site.published_commit_id && !input.includeSettings) throw new PublicationError('首次发布需要确认网站设置', 400)
  const issues = [...selected.flatMap((page) => page.issues), ...(input.includeSettings ? state.settingsIssues : [])]
  const token = randomBytes(32).toString('hex')
  const taskId = randomUUID()
  const sandboxId = `publication-${taskId}`
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString()
  const candidatePages = new Map(state.online)
  const selectedPages: Snapshot['selectedPages'] = {}
  for (const page of selected) {
    const content = state.current.get(page.pageId) ?? null
    selectedPages[page.pageId] = content
    if (!content || content.status === 'unpublished') candidatePages.delete(page.pageId)
    else candidatePages.set(page.pageId, { ...content, status: 'published' })
  }
  const settings = input.includeSettings ? state.settings : state.site.settings as SiteSettings
  const snapshot: Snapshot = { pages: [...candidatePages.values()], selected, selectedPages, settings, settingsChanged,
    draftBaseCommitId: state.row.base_commit_id as string | null, issues }
  const remote = requireRemoteServiceConfig()
  let remoteSiteId = state.site.remote_site_id as string | null
  if (!remoteSiteId) {
    remoteSiteId = String(state.site.site_id)
    const created = await remoteCreateSite(remote, { remoteSiteId })
    if (created.remoteSiteId !== remoteSiteId) throw new PublicationError('远端服务需要升级选择发布协议', 503)
    await pool.query(`UPDATE sites SET remote_site_id=$2,public_url=$3 WHERE site_id=$1`, [state.site.site_id, remoteSiteId, created.publicUrl])
    state.site.public_url = created.publicUrl
  }
  const remoteSite = await remoteGetSite(remote, remoteSiteId)
  if (remoteSite.selectedPublicationVersion !== 1) throw new PublicationError('远端服务需要升级选择发布协议', 503)
  if (remoteSite.publishedCommitId !== state.site.published_commit_id) throw new PublicationError('线上版本已经变化，请同步网站后重新预检', 409)
  const candidate = await SyncWorkspace.create({ cursorAgentCommand: appConfig.cursorAgentCommand, sandboxRoot: appConfig.sandboxRoot,
    draftId: sandboxId, remote, remoteSiteId, baseCommitId: remoteSite.publishedCommitId })
  if (remoteSite.publishedCommitId) {
    const actual = new Map<string, StoredPageJson>()
    for (const file of await candidate.listFiles(SITE_PATHS.pagesDir)) {
      if (!file.endsWith('.json')) continue
      const page = await readPageFromWorkspace(candidate, file.slice(file.lastIndexOf('/') + 1, -5))
      if (page && page.status !== 'unpublished') actual.set(page.pageId, page)
    }
    if (!state.snapshotComplete || actual.size !== state.online.size || [...actual].some(([pageId, page]) => !samePage(page, state.online.get(pageId) ?? null))) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const site = (await client.query(`SELECT published_commit_id FROM sites WHERE site_id=$1 FOR UPDATE`, [state.site.site_id])).rows[0]!
        if (site.published_commit_id !== remoteSite.publishedCommitId) throw new PublicationError('线上版本已经变化，请重新预检', 409)
        await client.query(`DELETE FROM site_published_pages WHERE site_id=$1`, [state.site.site_id])
        for (const page of actual.values()) await client.query(`INSERT INTO site_published_pages(site_id,page_id,kind,slug,title,locale,seo,body,published_commit_id,metadata,source_page)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [state.site.site_id, page.pageId, page.kind, page.slug, page.title, page.locale, page.seo, page.body,
          remoteSite.publishedCommitId, { ...page.metadata, translationGroupId: page.translationGroupId }, page])
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
      return previewPublicationUnlocked(userId, draftId, input)
    }
  }
  if (issues.length) return { token: null, pages: selected, settingsChanged, issues, expiresAt, baseCommitId: remoteSite.publishedCommitId }
  if (!selected.some((page) => page.changed) && !settingsChanged) throw new PublicationError('请选择存在变化的页面或网站设置', 400)
  if (!remoteSite.publishedCommitId) await bootstrapNewDraftWorkspace(candidate, { pendingSiteId: String(state.site.site_id), publicSiteUrl: remoteSite.publicUrl })
  await refreshManagedSiteBuilder(candidate)
  for (const file of await candidate.listFiles(SITE_PATHS.pagesDir)) if (file.endsWith('.json')) await candidate.deleteFile(file)
  for (const page of snapshot.pages) await writePageToWorkspace(candidate, page)
  await writeSiteSettingsToWorkspace(candidate, settings)
  await ensurePublishConfigForPush(candidate, { siteId: String(state.site.site_id), publicSiteUrl: remoteSite.publicUrl })
  const resourceIssues = await preparePublicationResources({ source: state.workspace, candidate, pages: snapshot.pages, selectedPageIds: selectedIds, publicUrl: remoteSite.publicUrl })
  issues.push(...resourceIssues)
  if (!issues.length) {
    const validation = await candidate.runValidation()
    if (!validation.ok) issues.push({ code: 'BUILD_FAILED', message: validation.log })
  }
  if (issues.length) return { token: null, pages: selected, settingsChanged, issues, expiresAt, baseCommitId: remoteSite.publishedCommitId }
  snapshot.resourceManifest = []
  for (const relative of await candidate.listFiles('assets')) snapshot.resourceManifest.push({ path: relative, digest: createHash('sha256').update(await candidate.readFile(relative)).digest('hex') })
  if (candidate.getState().status === 'dirty') await candidate.saveVersion('发布确认内容')
  const candidateCommitId = candidate.getState().headCommitId
  await pool.query(`INSERT INTO selected_publication_tasks(task_id,token_hash,user_id,draft_id,site_id,base_commit_id,candidate_commit_id,candidate_sandbox_id,snapshot,status,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'preview',$10)`, [taskId, hash(token), userId, draftId, state.site.site_id,
    remoteSite.publishedCommitId, candidateCommitId, sandboxId, snapshot, expiresAt])
  return { token, taskId, pages: selected, settingsChanged, issues, expiresAt, baseCommitId: remoteSite.publishedCommitId }
}

async function recordSuccess(client: pg.PoolClient, task: Record<string, any>, remoteSite: { publishedCommitId: string | null; publicUrl: string }) {
  const snapshot = task.snapshot as Snapshot
  await client.query('BEGIN')
  try {
    const publishedCommitId = remoteSite.publishedCommitId!
    await client.query(`UPDATE sites SET settings=$2,published_commit_id=$3,public_url=$4,updated_at=NOW() WHERE site_id=$1`, [task.site_id, snapshot.settings, publishedCommitId, remoteSite.publicUrl])
    await client.query(`DELETE FROM site_published_pages WHERE site_id=$1`, [task.site_id])
    for (const page of snapshot.pages) await client.query(`INSERT INTO site_published_pages(site_id,page_id,kind,slug,title,locale,seo,body,published_commit_id,metadata,source_page)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [task.site_id, page.pageId, page.kind, page.slug, page.title, page.locale,
      page.seo, page.body, publishedCommitId, { ...page.metadata, translationGroupId: page.translationGroupId }, page])
    for (const selected of snapshot.selected) {
      const page = snapshot.selectedPages[selected.pageId]
      await client.query(`INSERT INTO draft_page_publication_bases(draft_id,page_id,published_commit_id,draft_base_commit_id,page) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(draft_id,page_id) DO UPDATE SET published_commit_id=$3,draft_base_commit_id=$4,page=$5`,
      [task.draft_id, selected.pageId, publishedCommitId, snapshot.draftBaseCommitId, page?.status === 'unpublished' ? null : page])
      if (page && selected.operation === 'publish') await client.query(`UPDATE pages SET status='published',published_at=NOW()
        WHERE draft_id=$1 AND page_id=$2 AND kind=$3 AND slug=$4 AND title=$5 AND locale=$6 AND seo=$7 AND body=$8 AND metadata=$9 AND status <> 'unpublished'`,
      [task.draft_id, page.pageId, page.kind, page.slug, page.title, page.locale, page.seo, page.body, { ...page.metadata, translationGroupId: page.translationGroupId }])
    }
    const result = { task: { taskId: String(task.task_id), status: 'completed', publishedCommitId },
      site: { siteId: String(task.site_id), publicUrl: remoteSite.publicUrl }, publicUrl: remoteSite.publicUrl }
    await client.query(`UPDATE selected_publication_tasks SET status='completed',result=$2,error=NULL,updated_at=NOW() WHERE task_id=$1`, [task.task_id, result])
    await client.query('COMMIT')
    return result
  } catch (error) { await client.query('ROLLBACK'); throw error }
}
export async function confirmPublication(userId: string, draftId: string, token: string) {
  await authorized(userId, draftId)
  const found = await pool.query(`SELECT * FROM selected_publication_tasks WHERE token_hash=$1 AND user_id=$2 AND draft_id=$3`, [hash(token), userId, draftId])
  if (!found.rowCount) throw new PublicationError('发布确认内容不存在', 404)
  return executeTask(found.rows[0]!, userId)
}
async function executeTask(initial: Record<string, any>, userId: string, callerDraftId = String(initial.draft_id)) {
  const client = await pool.connect()
  try {
    await client.query(`SELECT pg_advisory_lock(hashtextextended($1, 0))`, [`selected-publication:${initial.site_id}`])
    const callerDraft = await authorized(userId, callerDraftId)
    if (callerDraft.site_id !== initial.site_id) throw new PublicationError('发布任务不存在', 404)
    const task = (await client.query(`SELECT * FROM selected_publication_tasks WHERE task_id=$1`, [initial.task_id])).rows[0]!
    if (task.site_id !== callerDraft.site_id || (task.status === 'preview' && (task.user_id !== userId || task.draft_id !== callerDraftId))) throw new PublicationError('发布任务不存在', 404)
    if (task.status === 'completed') return task.result
    if (task.status === 'failed') throw new PublicationError('该发布任务已经终止，请重新预检', 409)
    const active = await client.query(`SELECT task_id FROM selected_publication_tasks WHERE site_id=$1 AND status IN ('publishing','reconciling') AND task_id<>$2`, [task.site_id, task.task_id])
    if (active.rowCount) throw new PublicationError('网站存在需要核对的发布任务', 409)
    if (task.status === 'preview' && new Date(task.expires_at).getTime() <= Date.now()) throw new PublicationError('发布确认已经过期，请重新预检', 410)
    const site = (await client.query(`SELECT * FROM sites WHERE site_id=$1`, [task.site_id])).rows[0]!
    const remote = requireRemoteServiceConfig()
    const remoteSite = await remoteGetSite(remote, site.remote_site_id)
    if (remoteSite.selectedPublicationVersion !== 1) throw new PublicationError('远端服务需要升级选择发布协议', 503)
    if (remoteSite.publishedCommitId === task.candidate_commit_id) return await recordSuccess(client, task, remoteSite)
    if (remoteSite.publishedCommitId !== task.base_commit_id || site.published_commit_id !== task.base_commit_id) {
      await client.query(`UPDATE selected_publication_tasks SET status='failed',error='线上版本已经变化',updated_at=NOW() WHERE task_id=$1`, [task.task_id])
      throw new PublicationError('线上版本已经变化，请重新预检', 409)
    }
    await client.query(`UPDATE selected_publication_tasks SET status='publishing',updated_at=NOW() WHERE task_id=$1`, [task.task_id])
    const candidate = await SyncWorkspace.open({ cursorAgentCommand: appConfig.cursorAgentCommand, sandboxRoot: appConfig.sandboxRoot,
      draftId: task.candidate_sandbox_id, remote, remoteSiteId: site.remote_site_id, baseCommitId: task.base_commit_id, headCommitId: task.candidate_commit_id })
    try {
      const pushed = await candidate.publishFixedSnapshot(task.base_commit_id, task.candidate_commit_id)
      return await recordSuccess(client, task, { publishedCommitId: pushed.publishedCommitId!, publicUrl: pushed.publicUrl! })
    } catch (error) {
      await client.query(`UPDATE selected_publication_tasks SET status=$3,error=$2,updated_at=NOW() WHERE task_id=$1`, [task.task_id, error instanceof Error ? error.message : String(error), error instanceof RemotePushError && error.status < 500 ? 'failed' : 'reconciling'])
      if (error instanceof RemotePushError && error.status < 500) throw new PublicationError(error.message, error.status === 409 ? 409 : 422, [], String(task.task_id))
      throw new PublicationError('发布任务需要核对，请查询任务状态后继续', 503, [], String(task.task_id))
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [`selected-publication:${initial.site_id}`])
    client.release()
  }
}
export async function getPublicationTask(userId: string, draftId: string, taskId: string) {
  const callerDraft = await authorized(userId, draftId)
  const found = await pool.query(`SELECT t.* FROM selected_publication_tasks t WHERE t.task_id=$1 AND t.site_id=$2
    AND (t.status<>'preview' OR t.user_id=$3 OR EXISTS(SELECT 1 FROM draft_owners o WHERE o.draft_id=t.draft_id AND o.user_id=$3))`, [taskId, callerDraft.site_id, userId])
  if (!found.rowCount) throw new PublicationError('发布任务不存在', 404)
  const task = found.rows[0]!
  if (task.status === 'publishing' || task.status === 'reconciling') return executeTask(task, userId, draftId)
  return task.result ?? { task: { taskId, status: String(task.status), error: task.error as string | null } }
}
export async function listPublicationTasks(userId: string, draftId: string) {
  const callerDraft = await authorized(userId, draftId, false)
  const siteAccess = await canPublishDraft(userId, draftId)
  const result = await pool.query(`SELECT t.task_id,t.status,t.result,t.error,t.created_at,t.updated_at,t.snapshot->'selected' AS pages
    FROM selected_publication_tasks t WHERE t.site_id=$3 AND (t.draft_id=$1 OR $4::boolean)
      AND (t.status<>'preview' OR t.user_id=$2 OR EXISTS(SELECT 1 FROM draft_owners o WHERE o.draft_id=t.draft_id AND o.user_id=$2))
    ORDER BY t.created_at DESC LIMIT 100`, [draftId, userId, callerDraft.site_id, siteAccess])
  return { tasks: result.rows.map((row) => ({ taskId: String(row.task_id), status: String(row.status),
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    error: row.error as string | null, pages: row.pages as PublicationPage[], result: row.result as unknown })) }
}

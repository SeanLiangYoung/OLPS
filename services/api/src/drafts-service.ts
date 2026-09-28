import { randomUUID } from 'node:crypto'
import { SITE_PATHS, SyncWorkspace } from '@olps/sync'
import type { DraftRecord, PageKind, SiteRecord, SiteSettings } from '@olps/domain'
import { appConfig } from './config.js'
import { pool } from './db.js'
import { associateDraftHistoryWithSite } from './publish-history-site-association.js'
import { rowToDraft } from './draft-mapper.js'
import {
  defaultPageJson,
  pageRecordFromJson,
  readPageFromWorkspace,
  writePageToWorkspace,
  type StoredPageJson,
} from './page-sandbox.js'
import {
  openDraftWorkspace,
  readSiteSettingsFromWorkspace,
  writeSiteSettingsToWorkspace,
} from './workspace-factory.js'
import { persistDraftSyncState } from './draft-sync-state.js'
import {
  bootstrapNewDraftWorkspace,
  ensurePublishConfigForPush,
  workspaceHasSiteBuilder,
} from './workspace-bootstrap.js'
import { installSiteBuilder } from '@olps/site-builder'
import { validatePageBodyWithWorkspace } from './page-body-validation.js'
import { canPublishDraft, canSyncDraft, isDraftOwner, isSiteOwner } from './permissions.js'
import { rowToDraftFromRowOnly } from './draft-mapper.js'

import { requireRemoteServiceConfig } from './remote-service-config.js'
import { resolvePublicSiteUrlForRemote } from './remote-identity.js'
import { withDraftLock } from './draft-lock.js'
import {
  formatRemoteTransportError,
  isRemoteTransportError,
  persistPushRemoteTransportFailure,
} from './push-remote-transport-error.js'

async function fetchDraftRow(draftId: string): Promise<Record<string, unknown>> {
  const result = await pool.query(`SELECT * FROM site_drafts WHERE draft_id=$1`, [draftId])
  if (!result.rowCount) {
    throw new Error(`草稿不存在: ${draftId}`)
  }
  return result.rows[0]!
}

async function loadDraftRecord(draftId: string): Promise<DraftRecord> {
  const row = await fetchDraftRow(draftId)
  if (String(row.init_status) === 'failed') {
    return rowToDraftFromRowOnly(row, appConfig.defaultScreenCap)
  }
  const workspace = await openDraftWorkspaceFromRow(row)
  const settings = await readSiteSettingsFromWorkspace(workspace)
  return rowToDraft(row, settings)
}

function openDraftWorkspaceFromRow(row: Record<string, unknown>): Promise<SyncWorkspace> {
  return openDraftWorkspace({
    draftId: String(row.draft_id),
    sandboxId: String(row.sandbox_id),
    siteId: row.site_id ? String(row.site_id) : null,
    draftRemoteSiteId: row.remote_site_id ? String(row.remote_site_id) : null,
    baseCommitId: row.base_commit_id ? String(row.base_commit_id) : null,
    headCommitId: row.head_commit_id ? String(row.head_commit_id) : null,
  })
}

export async function reindexPagesFromSandbox(
  draftId: string,
  workspaceInput?: SyncWorkspace,
): Promise<void> {
  const row = await fetchDraftRow(draftId)
  const workspace = workspaceInput ?? (await openDraftWorkspaceFromRow(row))
  const files = await workspace.listFiles(SITE_PATHS.pagesDir)
  const siteId = row.site_id ? String(row.site_id) : null
  const seenPageIds = new Set<string>()
  const upsertRows: Array<{
    json: StoredPageJson
    now: string
  }> = []
  for (const rel of files) {
    if (!rel.endsWith('.json')) continue
    const pageId = rel.split('/').pop()!.replace(/\.json$/, '')
    const json = await readPageFromWorkspace(workspace, pageId)
    if (!json) continue
    seenPageIds.add(pageId)
    upsertRows.push({ json, now: new Date().toISOString() })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const { json, now } of upsertRows) {
      await client.query(
        `INSERT INTO pages(
          page_id, draft_id, site_id, kind, slug, title, status, locale, seo, body, created_at, updated_at, published_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13)
        ON CONFLICT (draft_id, page_id) DO UPDATE SET
          site_id=EXCLUDED.site_id,
          kind=EXCLUDED.kind,
          slug=EXCLUDED.slug,
          title=EXCLUDED.title,
          status=EXCLUDED.status,
          locale=EXCLUDED.locale,
          seo=EXCLUDED.seo,
          body=EXCLUDED.body,
          updated_at=EXCLUDED.updated_at,
          published_at=EXCLUDED.published_at`,
        [
          json.pageId,
          draftId,
          siteId,
          json.kind,
          json.slug,
          json.title,
          json.status,
          json.locale,
          JSON.stringify(json.seo),
          JSON.stringify(json.body),
          now,
          now,
          json.publishedAt ?? null,
        ],
      )
    }
    const existing = await client.query(`SELECT page_id FROM pages WHERE draft_id=$1`, [draftId])
    for (const dbRow of existing.rows) {
      const pid = String(dbRow.page_id)
      if (!seenPageIds.has(pid)) {
        await client.query(`DELETE FROM pages WHERE draft_id=$1 AND page_id=$2`, [draftId, pid])
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function createDraft(input: {
  userId: string
  name: string
  siteId?: string | null
}): Promise<DraftRecord> {
  if (input.siteId && !(await isSiteOwner(input.userId, input.siteId))) {
    throw new Error('FORBIDDEN_SITE')
  }

  const draftId = randomUUID()
  const sandboxId = draftId
  const now = new Date().toISOString()

  let remoteSiteId: string | null = null
  let baseCommitId: string | null = null
  if (input.siteId) {
    const site = await pool.query(
      `SELECT remote_site_id, published_commit_id FROM sites WHERE site_id=$1`,
      [input.siteId],
    )
    if (!site.rowCount) {
      throw new Error(`站点不存在: ${input.siteId}`)
    }
    remoteSiteId = site.rows[0]!.remote_site_id as string | null
    baseCommitId = site.rows[0]!.published_commit_id as string | null
    if (!remoteSiteId || !baseCommitId) {
      throw new Error('站点尚未发布到远端')
    }
  }

  const pendingSiteId = randomUUID()
  await pool.query(
    `INSERT INTO site_drafts(
      draft_id, site_id, name, sandbox_id, pending_site_id, base_commit_id, head_commit_id,
      status, init_status, sync_status, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,NULL,'active','initializing','clean',$7,$8)`,
    [draftId, input.siteId ?? null, input.name, sandboxId, pendingSiteId, baseCommitId, now, now],
  )
  await pool.query(
    `INSERT INTO draft_owners(draft_id, user_id, created_at) VALUES ($1,$2,$3)`,
    [draftId, input.userId, now],
  )

  try {
    const workspace = await SyncWorkspace.create({
      sandboxRoot: appConfig.sandboxRoot,
      draftId: sandboxId,
      remote: requireRemoteServiceConfig(),
      remoteSiteId,
      baseCommitId,
    })
    if (input.siteId) {
      if (!(await workspaceHasSiteBuilder(workspace))) {
        await installSiteBuilder(workspace.getState().workspacePath)
        await workspace.saveVersion('api: install site builder on clone')
      }
    } else {
      await bootstrapNewDraftWorkspace(workspace, { pendingSiteId })
    }
    const state = workspace.getState()
    await persistDraftSyncState(draftId, {
      baseCommitId: state.baseCommitId,
      headCommitId: state.headCommitId,
      syncStatus: state.status,
      initStatus: 'ready',
      lastError: null,
    })
    if (input.siteId) {
      await reindexPagesFromSandbox(draftId, workspace)
    }
    return loadDraftRecord(draftId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await persistDraftSyncState(draftId, {
      initStatus: 'failed',
      status: 'error',
      lastError: message,
    })
    throw err
  }
}

export async function listDraftsForUser(userId: string): Promise<DraftRecord[]> {
  const result = await pool.query(
    `SELECT d.* FROM site_drafts d
     INNER JOIN draft_owners o ON o.draft_id=d.draft_id
     WHERE o.user_id=$1 ORDER BY d.updated_at DESC`,
    [userId],
  )
  const drafts: DraftRecord[] = []
  for (const row of result.rows) {
    if (String(row.init_status) === 'failed') {
      drafts.push(rowToDraftFromRowOnly(row, appConfig.defaultScreenCap))
      continue
    }
    drafts.push(await loadDraftRecord(String(row.draft_id)))
  }
  return drafts
}

export async function getDraftForUser(userId: string, draftId: string): Promise<DraftRecord | null> {
  if (!(await isDraftOwner(userId, draftId))) {
    return null
  }
  return loadDraftRecord(draftId)
}

export async function patchDraftSettings(
  userId: string,
  draftId: string,
  patch: Partial<SiteSettings>,
): Promise<DraftRecord> {
  return withDraftLock(draftId, () => patchDraftSettingsUnlocked(userId, draftId, patch))
}

export async function patchDraftSettingsUnlocked(
  userId: string,
  draftId: string,
  patch: Partial<SiteSettings>,
): Promise<DraftRecord> {
  if (!(await isDraftOwner(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const row = await fetchDraftRow(draftId)
  const workspace = await openDraftWorkspace({
    draftId,
    sandboxId: String(row.sandbox_id),
    siteId: row.site_id ? String(row.site_id) : null,
    baseCommitId: row.base_commit_id ? String(row.base_commit_id) : null,
    headCommitId: row.head_commit_id ? String(row.head_commit_id) : null,
  })
  const current = await readSiteSettingsFromWorkspace(workspace)
  const next = { ...current, ...patch }
  await writeSiteSettingsToWorkspace(workspace, next)
  const state = workspace.getState()
  await persistDraftSyncState(draftId, {
    headCommitId: state.headCommitId,
    syncStatus: 'dirty',
  })
  return loadDraftRecord(draftId)
}

export async function createDraftPage(
  userId: string,
  draftId: string,
  input: { kind: PageKind; title: string; slug: string; locale?: string },
): Promise<import('@olps/domain').PageRecord> {
  return withDraftLock(draftId, () => createDraftPageUnlocked(userId, draftId, input))
}

export async function createDraftPageUnlocked(
  userId: string,
  draftId: string,
  input: { kind: PageKind; title: string; slug: string; locale?: string },
): Promise<import('@olps/domain').PageRecord> {
  if (!(await isDraftOwner(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const row = await fetchDraftRow(draftId)
  const pageId = randomUUID()
  const json = defaultPageJson({ pageId, ...input })
  const workspace = await openDraftWorkspaceFromRow(row)
  await writePageToWorkspace(workspace, json)
  await workspace.saveVersion('api: create page')
  const state = workspace.getState()
  await persistDraftSyncState(draftId, {
    headCommitId: state.headCommitId,
    syncStatus: state.status,
  })
  const now = new Date().toISOString()
  const siteId = row.site_id ? String(row.site_id) : null
  await pool.query(
    `INSERT INTO pages(
      page_id, draft_id, site_id, kind, slug, title, status, locale, seo, body, created_at, updated_at, published_at
    ) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8::jsonb,$9::jsonb,$10,$11,NULL)`,
    [
      pageId,
      draftId,
      siteId,
      json.kind,
      json.slug,
      json.title,
      json.locale,
      JSON.stringify(json.seo),
      JSON.stringify(json.body),
      now,
      now,
    ],
  )
  return pageRecordFromJson(draftId, siteId, json, { createdAt: now, updatedAt: now })
}

export async function listDraftPages(userId: string, draftId: string) {
  if (!(await isDraftOwner(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const result = await pool.query(`SELECT * FROM pages WHERE draft_id=$1 ORDER BY updated_at DESC`, [
    draftId,
  ])
  return result.rows.map((row) =>
    pageRecordFromJson(
      draftId,
      row.site_id ? String(row.site_id) : null,
      {
        pageId: String(row.page_id),
        kind: row.kind as PageKind,
        slug: String(row.slug),
        title: String(row.title),
        status: row.status as import('@olps/domain').PageStatus,
        locale: String(row.locale),
        seo: row.seo as import('@olps/domain').SeoFields,
        body: row.body as import('@olps/domain').PageBody,
        publishedAt: row.published_at ? String(row.published_at) : null,
      },
      {
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
      },
    ),
  )
}

export async function getDraftPageForUser(userId: string, draftId: string, pageId: string) {
  if (!(await isDraftOwner(userId, draftId))) {
    return null
  }
  const result = await pool.query(`SELECT * FROM pages WHERE draft_id=$1 AND page_id=$2`, [
    draftId,
    pageId,
  ])
  if (!result.rowCount) {
    return null
  }
  const row = result.rows[0]!
  const draftRow = await fetchDraftRow(draftId)
  const workspace = await openDraftWorkspace({
    draftId,
    sandboxId: String(draftRow.sandbox_id),
    siteId: draftRow.site_id ? String(draftRow.site_id) : null,
    baseCommitId: draftRow.base_commit_id ? String(draftRow.base_commit_id) : null,
    headCommitId: draftRow.head_commit_id ? String(draftRow.head_commit_id) : null,
  })
  const json = await readPageFromWorkspace(workspace, pageId)
  if (!json) {
    return null
  }
  return pageRecordFromJson(
    draftId,
    row.site_id ? String(row.site_id) : null,
    json,
    {
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    },
  )
}

export async function patchDraftPageForUser(
  userId: string,
  draftId: string,
  pageId: string,
  patch: { title?: string; slug?: string; seo?: import('@olps/domain').SeoFields; body?: import('@olps/domain').PageBody },
) {
  return withDraftLock(draftId, () => patchDraftPageForUserUnlocked(userId, draftId, pageId, patch))
}

export async function patchDraftPageForUserUnlocked(
  userId: string,
  draftId: string,
  pageId: string,
  patch: { title?: string; slug?: string; seo?: import('@olps/domain').SeoFields; body?: import('@olps/domain').PageBody },
) {
  if (!(await isDraftOwner(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const result = await pool.query(`SELECT * FROM pages WHERE draft_id=$1 AND page_id=$2`, [
    draftId,
    pageId,
  ])
  if (!result.rowCount) {
    throw new Error('NOT_FOUND')
  }
  const row = result.rows[0]!
  const draftRow = await fetchDraftRow(draftId)
  const workspace = await openDraftWorkspace({
    draftId,
    sandboxId: String(draftRow.sandbox_id),
    siteId: draftRow.site_id ? String(draftRow.site_id) : null,
    baseCommitId: draftRow.base_commit_id ? String(draftRow.base_commit_id) : null,
    headCommitId: draftRow.head_commit_id ? String(draftRow.head_commit_id) : null,
  })
  const json = await readPageFromWorkspace(workspace, pageId)
  if (!json) {
    throw new Error('SANDBOX_PAGE_MISSING')
  }
  const next: StoredPageJson = {
    ...json,
    title: patch.title ?? json.title,
    slug: patch.slug ?? json.slug,
    seo: patch.seo ?? json.seo,
    body: patch.body ?? json.body,
  }
  await validatePageBodyWithWorkspace(workspace, next.kind, next.body)
  await writePageToWorkspace(workspace, next)
  const state = workspace.getState()
  const now = new Date().toISOString()
  await pool.query(
    `UPDATE pages SET title=$1, slug=$2, seo=$3::jsonb, body=$4::jsonb, updated_at=$5
     WHERE draft_id=$6 AND page_id=$7`,
    [next.title, next.slug, JSON.stringify(next.seo), JSON.stringify(next.body), now, draftId, pageId],
  )
  await persistDraftSyncState(draftId, {
    headCommitId: state.headCommitId,
    syncStatus: 'dirty',
  })
  return pageRecordFromJson(
    draftId,
    row.site_id ? String(row.site_id) : null,
    next,
    {
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: now,
    },
  )
}

async function runAgentIfNeeded(workspace: SyncWorkspace): Promise<void> {
  const state = workspace.getState()
  if (state.status === 'merge_conflict') {
    await workspace.resolveConflictsWithAgent()
  }
}

function conflictHttpMessage(state: ReturnType<SyncWorkspace['getState']>): string {
  return state.conflictSummary ?? '同步冲突需要处理'
}

export async function pullDraft(userId: string, draftId: string): Promise<{ draft: DraftRecord; httpStatus: number }> {
  return withDraftLock(draftId, () => pullDraftUnlocked(userId, draftId))
}

export async function pullDraftUnlocked(
  userId: string,
  draftId: string,
): Promise<{ draft: DraftRecord; httpStatus: number }> {
  if (!(await canSyncDraft(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const row = await fetchDraftRow(draftId)
  const siteId = row.site_id ? String(row.site_id) : null
  if (!siteId) {
    throw new Error('PULL_NO_REMOTE_SOURCE')
  }
  await persistDraftSyncState(draftId, {
    status: 'syncing',
    pendingOperation: 'pull',
    lastError: null,
  })
  const workspace = await openDraftWorkspaceFromRow({ ...row, site_id: siteId })
  const pullResult = await workspace.pull()
  let state = workspace.getState()
  if (pullResult.status === 'merge_conflict') {
    await runAgentIfNeeded(workspace)
    state = workspace.getState()
  }
  if (state.status === 'merge_conflict' || state.status === 'awaiting_user' || state.status === 'validation_failed') {
    await persistDraftSyncState(draftId, {
      baseCommitId: state.baseCommitId,
      headCommitId: state.headCommitId,
      syncStatus: state.status,
      conflictSummary: state.conflictSummary ?? conflictHttpMessage(state),
      conflictMessage: state.conflictSummary ?? conflictHttpMessage(state),
      validationLog: state.validationLog ?? null,
      pendingOperation: 'pull',
      status: 'conflict',
    })
    return { draft: await loadDraftRecord(draftId), httpStatus: 409 }
  }
  await persistDraftSyncState(draftId, {
    baseCommitId: state.baseCommitId,
    headCommitId: state.headCommitId,
    syncStatus: state.status,
    conflictSummary: null,
    conflictMessage: null,
    validationLog: state.validationLog ?? null,
    pendingOperation: null,
    lastError: null,
    status: 'active',
  })
  await reindexPagesFromSandbox(draftId, workspace)
  return { draft: await loadDraftRecord(draftId), httpStatus: 200 }
}

export async function pushDraft(
  userId: string,
  draftId: string,
): Promise<{ draft: DraftRecord; site?: SiteRecord; httpStatus: number; error?: string }> {
  return withDraftLock(draftId, () => pushDraftUnlocked(userId, draftId))
}

export async function pushDraftUnlocked(
  userId: string,
  draftId: string,
): Promise<{ draft: DraftRecord; site?: SiteRecord; httpStatus: number; error?: string }> {
  if (!(await canPublishDraft(userId, draftId))) {
    throw new Error('FORBIDDEN_PUBLISH')
  }
  const row = await fetchDraftRow(draftId)
  let localSiteId = row.site_id ? String(row.site_id) : null
  if (!localSiteId) {
    localSiteId = row.pending_site_id ? String(row.pending_site_id) : null
  }
  if (!localSiteId) {
    localSiteId = randomUUID()
    await persistDraftSyncState(draftId, { pendingSiteId: localSiteId })
  }
  const remote = requireRemoteServiceConfig()
  await persistDraftSyncState(draftId, {
    status: 'syncing',
    pendingOperation: 'push',
    lastError: null,
  })
  let remoteSiteId = row.remote_site_id ? String(row.remote_site_id) : null
  let publicSiteUrl: string | undefined
  try {
    if (!remoteSiteId) {
      const { remoteCreateSite } = await import('@olps/sync')
      const created = await remoteCreateSite(remote)
      remoteSiteId = created.remoteSiteId
      publicSiteUrl = created.publicUrl
      await persistDraftSyncState(draftId, { remoteSiteId })
    } else {
      publicSiteUrl = await resolvePublicSiteUrlForRemote(
        remoteSiteId,
        row.site_id ? String(row.site_id) : null,
      )
    }
  } catch (err) {
    if (!isRemoteTransportError(err)) {
      throw err
    }
    await persistPushRemoteTransportFailure({ draftId, row, err })
    const message = formatRemoteTransportError(err)
    return {
      draft: await loadDraftRecord(draftId),
      httpStatus: 503,
      error: message,
    }
  }
  const workspace = await openDraftWorkspaceFromRow({ ...row, remote_site_id: remoteSiteId })
  await ensurePublishConfigForPush(workspace, { siteId: localSiteId, publicSiteUrl })
  const dirty = workspace.getState().status === 'dirty'
  if (dirty) {
    await workspace.saveVersion('api: pre-push snapshot')
  }
  let pushResult
  let state
  try {
    pushResult = await workspace.push()
    state = workspace.getState()
    if (pushResult.status === 'merge_conflict') {
      await runAgentIfNeeded(workspace)
      state = workspace.getState()
      if (state.status === 'clean' || state.status === 'dirty') {
        pushResult = await workspace.push()
        state = workspace.getState()
      }
    }
  } catch (err) {
    if (!isRemoteTransportError(err)) {
      throw err
    }
    await persistPushRemoteTransportFailure({ draftId, row, err, workspace })
    const message = formatRemoteTransportError(err)
    return {
      draft: await loadDraftRecord(draftId),
      httpStatus: 503,
      error: message,
    }
  }
  if (pushResult.status !== 'clean' || pushResult.error) {
    await persistDraftSyncState(draftId, {
      baseCommitId: state.baseCommitId,
      headCommitId: state.headCommitId,
      syncStatus: pushResult.status,
      conflictSummary: pushResult.conflictSummary ?? pushResult.error ?? null,
      conflictMessage: pushResult.conflictSummary ?? pushResult.error ?? null,
      validationLog: state.validationLog ?? null,
      pendingOperation: 'push',
      lastError: pushResult.error ?? null,
      status: pushResult.status === 'validation_failed' ? 'error' : 'conflict',
    })
    return {
      draft: await loadDraftRecord(draftId),
      httpStatus: pushResult.status === 'validation_failed' ? 500 : 409,
      error: pushResult.error,
    }
  }

  try {
    await reindexPagesFromSandbox(draftId, workspace)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state = workspace.getState()
    await persistDraftSyncState(draftId, {
      baseCommitId: pushResult.baseCommitId,
      headCommitId: pushResult.headCommitId,
      remoteSiteId: pushResult.remoteSiteId,
      syncStatus: state.status,
      pendingOperation: 'push',
      lastError: message,
      status: 'error',
    })
    return {
      draft: await loadDraftRecord(draftId),
      httpStatus: 500,
      error: message,
    }
  }

  const client = await pool.connect()
  let site: SiteRecord | undefined
  try {
    await client.query('BEGIN')
    let siteId = row.site_id ? String(row.site_id) : localSiteId
    const settings = await readSiteSettingsFromWorkspace(workspace)
    const now = new Date().toISOString()
    const existingSite = await client.query(
      `SELECT site_id FROM sites WHERE remote_site_id=$1`,
      [pushResult.remoteSiteId],
    )
    if (existingSite.rowCount) {
      siteId = String(existingSite.rows[0]!.site_id)
    }
    if (!(await client.query(`SELECT 1 FROM sites WHERE site_id=$1`, [siteId])).rowCount) {
      await client.query(
        `INSERT INTO sites(
          site_id, name, settings, remote_site_id, published_commit_id, public_url, created_at, updated_at
        ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8)`,
        [
          siteId,
          String(row.name),
          JSON.stringify(settings),
          pushResult.remoteSiteId,
          pushResult.publishedCommitId,
          pushResult.publicUrl,
          now,
          now,
        ],
      )
      const owners = await client.query(`SELECT user_id FROM draft_owners WHERE draft_id=$1`, [draftId])
      for (const owner of owners.rows) {
        await client.query(
          `INSERT INTO site_owners(site_id, user_id, created_at) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`,
          [siteId, String(owner.user_id), now],
        )
      }
      await client.query(`UPDATE site_drafts SET site_id=$2 WHERE draft_id=$1`, [draftId, siteId])
      await client.query(`UPDATE pages SET site_id=$2 WHERE draft_id=$1`, [draftId, siteId])
    } else {
      await client.query(
        `UPDATE sites SET
          settings=$2::jsonb,
          remote_site_id=$3,
          published_commit_id=$4,
          public_url=$5,
          updated_at=$6
         WHERE site_id=$1`,
        [
          siteId,
          JSON.stringify(settings),
          pushResult.remoteSiteId,
          pushResult.publishedCommitId,
          pushResult.publicUrl,
          now,
        ],
      )
    }
    await client.query(
      `UPDATE site_drafts SET
        base_commit_id=$2,
        head_commit_id=$3,
        sync_status='clean',
        conflict_message=NULL,
        conflict_summary=NULL,
        validation_log=NULL,
        pending_operation=NULL,
        last_error=NULL,
        status='active',
        site_id=$4,
        updated_at=$5
       WHERE draft_id=$1`,
      [draftId, pushResult.baseCommitId, pushResult.headCommitId, siteId, now],
    )
    const publishedAt = new Date().toISOString()
    await client.query(
      `UPDATE pages SET status='published', published_at=$2, site_id=$3 WHERE draft_id=$1`,
      [draftId, publishedAt, siteId],
    )
    await client.query(`DELETE FROM site_published_pages WHERE site_id=$1`, [siteId])
    await client.query(
      `INSERT INTO site_published_pages(
        site_id, page_id, kind, slug, title, locale, seo, body, published_commit_id
      )
      SELECT $1, page_id, kind, slug, title, locale, seo, body, $2
      FROM pages WHERE draft_id=$3`,
      [siteId, pushResult.publishedCommitId, draftId],
    )
    await associateDraftHistoryWithSite(client, draftId, siteId)
    await client.query('COMMIT')
    const siteRow = await pool.query(`SELECT * FROM sites WHERE site_id=$1`, [siteId])
    site = mapSiteRow(siteRow.rows[0]!)
  } catch (err) {
    await client.query('ROLLBACK')
    await persistDraftSyncState(draftId, {
      baseCommitId: pushResult.baseCommitId,
      headCommitId: pushResult.headCommitId,
      remoteSiteId: pushResult.remoteSiteId,
      pendingOperation: 'push',
      lastError: err instanceof Error ? err.message : String(err),
      status: 'error',
    })
    throw err
  } finally {
    client.release()
  }
  return { draft: await loadDraftRecord(draftId), site, httpStatus: 200 }
}

function mapSiteRow(row: Record<string, unknown>): SiteRecord {
  return {
    siteId: String(row.site_id),
    name: String(row.name),
    settings: row.settings as SiteSettings,
    remoteSiteId: row.remote_site_id ? String(row.remote_site_id) : null,
    publishedCommitId: row.published_commit_id ? String(row.published_commit_id) : null,
    publicUrl: row.public_url ? String(row.public_url) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function continueDraft(
  userId: string,
  draftId: string,
  userMessage: string,
): Promise<{ draft: DraftRecord; httpStatus: number }> {
  return withDraftLock(draftId, () => continueDraftUnlocked(userId, draftId, userMessage))
}

export async function continueDraftUnlocked(
  userId: string,
  draftId: string,
  userMessage: string,
): Promise<{ draft: DraftRecord; httpStatus: number }> {
  if (!(await canSyncDraft(userId, draftId))) {
    throw new Error('FORBIDDEN')
  }
  const row = await fetchDraftRow(draftId)
  const pending = row.pending_operation as 'pull' | 'push' | null
  const workspace = await openDraftWorkspaceFromRow(row)
  await workspace.continueAfterUser({ userMessage })
  let state = workspace.getState()
  if (state.status === 'merge_conflict') {
    await workspace.resolveConflictsWithAgent()
    state = workspace.getState()
  }
  if (state.status === 'awaiting_user' || state.status === 'merge_conflict') {
    await persistDraftSyncState(draftId, {
      syncStatus: state.status,
      conflictSummary: state.conflictSummary ?? null,
      conflictMessage: state.conflictSummary ?? null,
      status: 'conflict',
    })
    return { draft: await loadDraftRecord(draftId), httpStatus: 409 }
  }
  if (pending === 'pull') {
    const pullResult = await workspace.pull()
    state = workspace.getState()
    if (pullResult.status !== 'clean') {
      await persistDraftSyncState(draftId, {
        syncStatus: state.status,
        status: 'conflict',
        conflictMessage: state.conflictSummary ?? null,
      })
      return { draft: await loadDraftRecord(draftId), httpStatus: 409 }
    }
    await persistDraftSyncState(draftId, {
      baseCommitId: state.baseCommitId,
      headCommitId: state.headCommitId,
      syncStatus: 'clean',
      pendingOperation: null,
      status: 'active',
    })
    await reindexPagesFromSandbox(draftId, workspace)
    return { draft: await loadDraftRecord(draftId), httpStatus: 200 }
  }
  if (pending === 'push') {
    const pushed = await pushDraftUnlocked(userId, draftId)
    return { draft: pushed.draft, httpStatus: pushed.httpStatus }
  }
  await persistDraftSyncState(draftId, {
    syncStatus: state.status,
    pendingOperation: null,
    status: 'active',
  })
  return { draft: await loadDraftRecord(draftId), httpStatus: 200 }
}

export { mapSiteRow }

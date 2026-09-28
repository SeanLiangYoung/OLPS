import { remoteCreateSite } from '@olps/sync'
import { appConfig } from './config.js'
import { pool } from './db.js'
import { persistDraftSyncState } from './draft-sync-state.js'

function remoteConfig() {
  if (!appConfig.remoteServiceUrl || !appConfig.remoteServiceToken) {
    throw new Error('缺少 REMOTE_SERVICE_URL 或 REMOTE_SERVICE_TOKEN')
  }
  return {
    baseUrl: appConfig.remoteServiceUrl,
    token: appConfig.remoteServiceToken,
  }
}

export async function fetchRemoteSitePublicUrl(remoteSiteId: string): Promise<string> {
  const remote = remoteConfig()
  const base = remote.baseUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/api/remote/sites/${encodeURIComponent(remoteSiteId)}`, {
    headers: { Authorization: `Bearer ${remote.token}` },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`读取远端站点失败 ${res.status}: ${body}`)
  }
  const info = (await res.json()) as { publicUrl: string }
  if (!info.publicUrl) {
    throw new Error(`远端站点缺少 publicUrl: ${remoteSiteId}`)
  }
  return info.publicUrl
}

export async function resolvePublicSiteUrlForRemote(
  remoteSiteId: string,
  siteId: string | null,
): Promise<string> {
  if (siteId) {
    const site = await pool.query(`SELECT public_url FROM sites WHERE site_id=$1`, [siteId])
    if (site.rowCount && site.rows[0]!.public_url) {
      return String(site.rows[0]!.public_url)
    }
  }
  const byRemote = await pool.query(`SELECT public_url FROM sites WHERE remote_site_id=$1`, [
    remoteSiteId,
  ])
  if (byRemote.rowCount && byRemote.rows[0]!.public_url) {
    return String(byRemote.rows[0]!.public_url)
  }
  return fetchRemoteSitePublicUrl(remoteSiteId)
}

export async function ensureDraftRemoteSiteId(draftId: string): Promise<string> {
  const row = await pool.query(
    `SELECT remote_site_id FROM site_drafts WHERE draft_id=$1 FOR UPDATE`,
    [draftId],
  )
  if (!row.rowCount) {
    throw new Error(`草稿不存在: ${draftId}`)
  }
  const existing = row.rows[0]!.remote_site_id as string | null
  if (existing) {
    return existing
  }
  const created = await remoteCreateSite(remoteConfig())
  await persistDraftSyncState(draftId, { remoteSiteId: created.remoteSiteId })
  return created.remoteSiteId
}

export async function ensureDraftPendingSiteId(draftId: string): Promise<string> {
  const row = await pool.query(
    `SELECT site_id, pending_site_id FROM site_drafts WHERE draft_id=$1 FOR UPDATE`,
    [draftId],
  )
  if (!row.rowCount) {
    throw new Error(`草稿不存在: ${draftId}`)
  }
  const siteId = row.rows[0]!.site_id as string | null
  if (siteId) {
    return siteId
  }
  const pending = row.rows[0]!.pending_site_id as string | null
  if (pending) {
    return pending
  }
  const { randomUUID } = await import('node:crypto')
  const next = randomUUID()
  await persistDraftSyncState(draftId, { pendingSiteId: next })
  return next
}

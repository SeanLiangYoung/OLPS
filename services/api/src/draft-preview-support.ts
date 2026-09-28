import type { SyncWorkspace } from '@olps/sync'
import { pool } from './db.js'
import { openDraftWorkspace } from './workspace-factory.js'

export async function fetchDraftRow(draftId: string): Promise<Record<string, unknown>> {
  const result = await pool.query(`SELECT * FROM site_drafts WHERE draft_id=$1`, [draftId])
  if (!result.rowCount) {
    throw new Error('NOT_FOUND')
  }
  return result.rows[0]!
}

export function openDraftWorkspaceFromRow(row: Record<string, unknown>): Promise<SyncWorkspace> {
  return openDraftWorkspace({
    draftId: String(row.draft_id),
    sandboxId: String(row.sandbox_id),
    siteId: row.site_id ? String(row.site_id) : null,
    draftRemoteSiteId: row.remote_site_id ? String(row.remote_site_id) : null,
    baseCommitId: row.base_commit_id ? String(row.base_commit_id) : null,
    headCommitId: row.head_commit_id ? String(row.head_commit_id) : null,
  })
}

import { pool } from './db.js'

export type DraftSyncStatePatch = {
  baseCommitId?: string | null
  headCommitId?: string | null
  remoteSiteId?: string | null
  pendingSiteId?: string | null
  syncStatus?: string | null
  conflictMessage?: string | null
  conflictSummary?: string | null
  validationLog?: string | null
  pendingOperation?: 'pull' | 'push' | null
  lastError?: string | null
  status?: string | null
  siteId?: string | null
  initStatus?: string | null
}

export async function persistDraftSyncState(
  draftId: string,
  patch: DraftSyncStatePatch,
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = [draftId]
  let index = 2

  function add(field: string, value: unknown): void {
    sets.push(`${field}=$${index}`)
    values.push(value)
    index += 1
  }

  if ('baseCommitId' in patch) {
    add('base_commit_id', patch.baseCommitId ?? null)
  }
  if ('headCommitId' in patch) {
    add('head_commit_id', patch.headCommitId ?? null)
  }
  if ('remoteSiteId' in patch) {
    add('remote_site_id', patch.remoteSiteId ?? null)
  }
  if ('pendingSiteId' in patch) {
    add('pending_site_id', patch.pendingSiteId ?? null)
  }
  if ('syncStatus' in patch) {
    add('sync_status', patch.syncStatus ?? null)
  }
  if ('conflictMessage' in patch) {
    add('conflict_message', patch.conflictMessage ?? null)
  }
  if ('conflictSummary' in patch) {
    add('conflict_summary', patch.conflictSummary ?? null)
  }
  if ('validationLog' in patch) {
    add('validation_log', patch.validationLog ?? null)
  }
  if ('pendingOperation' in patch) {
    add('pending_operation', patch.pendingOperation ?? null)
  }
  if ('lastError' in patch) {
    add('last_error', patch.lastError ?? null)
  }
  if ('status' in patch) {
    add('status', patch.status ?? null)
  }
  if ('siteId' in patch) {
    add('site_id', patch.siteId ?? null)
  }
  if ('initStatus' in patch) {
    add('init_status', patch.initStatus ?? null)
  }

  if (sets.length === 0) {
    return
  }

  add('updated_at', new Date().toISOString())
  await pool.query(`UPDATE site_drafts SET ${sets.join(', ')} WHERE draft_id=$1`, values)
}

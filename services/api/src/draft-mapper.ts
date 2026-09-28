import {
  defaultSiteSettings,
  type DraftInitStatus,
  type DraftRecord,
  type DraftStatus,
  type DraftSyncStatus,
  type SiteSettings,
} from '@olps/domain'
import type { DraftSyncStatus as SyncPkgStatus } from '@olps/sync'

export function mapApiDraftStatus(input: {
  syncStatus: SyncPkgStatus
  lastError: string | null
  pendingOperation: 'pull' | 'push' | null
  explicitStatus?: string | null
}): DraftStatus {
  if (input.explicitStatus === 'syncing') {
    return 'syncing'
  }
  if (input.lastError) {
    return 'error'
  }
  if (
    input.syncStatus === 'merge_conflict' ||
    input.syncStatus === 'awaiting_user' ||
    input.syncStatus === 'validation_failed'
  ) {
    return 'conflict'
  }
  return 'active'
}

export function rowToDraftFromRowOnly(
  row: Record<string, unknown>,
  screenCap = 20,
): DraftRecord {
  return rowToDraft(row, defaultSiteSettings(screenCap))
}

export function rowToDraft(row: Record<string, unknown>, settings: SiteSettings): DraftRecord {
  const syncStatus = (row.sync_status as DraftSyncStatus | null) ?? 'clean'
  const lastError = row.last_error ? String(row.last_error) : null
  const pendingOperation = row.pending_operation as 'pull' | 'push' | null
  const status = mapApiDraftStatus({
    syncStatus,
    lastError,
    pendingOperation,
    explicitStatus: row.status ? String(row.status) : null,
  })
  const initStatus = (row.init_status ? String(row.init_status) : 'ready') as DraftInitStatus
  return {
    draftId: String(row.draft_id),
    siteId: row.site_id ? String(row.site_id) : null,
    name: String(row.name),
    initStatus,
    settings,
    sandboxId: String(row.sandbox_id),
    baseCommitId: row.base_commit_id ? String(row.base_commit_id) : null,
    headCommitId: row.head_commit_id ? String(row.head_commit_id) : null,
    status,
    syncStatus,
    conflictMessage: row.conflict_message ? String(row.conflict_message) : null,
    conflictSummary: row.conflict_summary ? String(row.conflict_summary) : null,
    validationLog: row.validation_log ? String(row.validation_log) : null,
    pendingOperation,
    lastError,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

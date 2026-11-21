export const DRAFT_ORDINARY_EDIT_BLOCKED = 'DRAFT_ORDINARY_EDIT_BLOCKED'

export function assertDraftOrdinaryEditAllowed(row: Record<string, unknown>): void {
  const explicitStatus = row.status ? String(row.status) : ''
  if ((explicitStatus && explicitStatus !== 'active') || (row.init_status && row.init_status !== 'ready')) {
    throw new Error(DRAFT_ORDINARY_EDIT_BLOCKED)
  }
  const syncStatus = String(row.sync_status ?? 'clean')
  if (syncStatus === 'awaiting_user' || syncStatus === 'merge_conflict') {
    throw new Error(DRAFT_ORDINARY_EDIT_BLOCKED)
  }
}

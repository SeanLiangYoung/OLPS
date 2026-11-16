import type { DraftRecord } from '@olps/domain'
import { RemotePushError, type SyncWorkspace } from '@olps/sync'
import { persistDraftSyncState } from './draft-sync-state.js'
import { openDraftWorkspace } from './workspace-factory.js'

export function formatRemoteTransportError(err: unknown): string {
  if (err instanceof Error) {
    const cause = 'cause' in err ? (err as Error & { cause?: unknown }).cause : undefined
    if (cause instanceof Error) {
      return `远端请求失败: ${cause.message}`
    }
    return err.message
  }
  return String(err)
}

export function isRemoteTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false
  }
  if (err instanceof RemotePushError && err.status >= 500) return true
  if (err.message === 'fetch failed') {
    return true
  }
  const cause = 'cause' in err ? (err as Error & { cause?: unknown }).cause : undefined
  if (cause instanceof Error) {
    if (cause.message.includes('ECONNREFUSED')) {
      return true
    }
    const code = 'code' in cause ? String((cause as NodeJS.ErrnoException).code) : ''
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
      return true
    }
  }
  return false
}

export async function persistDraftRemoteTransportFailure(input: {
  draftId: string
  row: Record<string, unknown>
  err: unknown
  pendingOperation: 'pull' | 'push'
  workspace?: SyncWorkspace
}): Promise<void> {
  let headCommitId = input.row.head_commit_id ? String(input.row.head_commit_id) : null
  let baseCommitId = input.row.base_commit_id ? String(input.row.base_commit_id) : null
  const workspace =
    input.workspace ??
    (await openDraftWorkspace({
      draftId: String(input.row.draft_id),
      sandboxId: String(input.row.sandbox_id),
      siteId: input.row.site_id ? String(input.row.site_id) : null,
      draftRemoteSiteId: input.row.remote_site_id ? String(input.row.remote_site_id) : null,
      baseCommitId,
      headCommitId,
    }))
  const state = workspace.getState()
  headCommitId = state.headCommitId
  baseCommitId = state.baseCommitId
  const message = formatRemoteTransportError(input.err)
  await persistDraftSyncState(input.draftId, {
    baseCommitId,
    headCommitId,
    pendingOperation: input.pendingOperation,
    lastError: message,
    status: 'error',
    syncStatus: state.status,
  })
}

export async function persistPushRemoteTransportFailure(input: {
  draftId: string
  row: Record<string, unknown>
  err: unknown
  workspace?: SyncWorkspace
}): Promise<void> {
  await persistDraftRemoteTransportFailure({ ...input, pendingOperation: 'push' })
}

export async function persistPullRemoteTransportFailure(input: {
  draftId: string
  row: Record<string, unknown>
  err: unknown
  workspace?: SyncWorkspace
}): Promise<void> {
  await persistDraftRemoteTransportFailure({ ...input, pendingOperation: 'pull' })
}

export type PushDraftFailureResult = {
  draft: DraftRecord
  httpStatus: number
  error: string
}

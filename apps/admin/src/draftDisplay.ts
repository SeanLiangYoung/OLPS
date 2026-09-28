import type { DraftStatus, DraftSyncStatus, SiteDraft } from './types'

const KNOWN_DRAFT_STATUSES: DraftStatus[] = ['active', 'syncing', 'conflict', 'error']

const STATUS_LABEL: Record<DraftStatus, string> = {
  active: '就绪',
  syncing: '同步处理中',
  conflict: '等待用户决定',
  error: '同步失败',
}

const SYNC_LABEL: Record<DraftSyncStatus, string> = {
  clean: '工作区已保存',
  dirty: '有未提交修改',
  merge_conflict: '合并冲突处理中',
  awaiting_user: '等待用户输入决定',
  validation_failed: '验证未通过',
}

export function isKnownDraftStatus(status: string): status is DraftStatus {
  return (KNOWN_DRAFT_STATUSES as string[]).includes(status)
}

export function draftStatusLabel(status: string): string {
  if (isKnownDraftStatus(status)) return STATUS_LABEL[status]
  return `未识别的状态 ${status}`
}

export function syncProcessingLabel(syncStatus: DraftSyncStatus | null | undefined): string {
  if (!syncStatus) return ''
  return SYNC_LABEL[syncStatus] ?? `未识别的处理状态 ${syncStatus}`
}

export function formatCommitRef(commitId: string | null | undefined): string {
  if (!commitId) return '—'
  return commitId.slice(0, 7)
}

export function syncActionDisabledReason(
  draft: SiteDraft,
  action: 'push' | 'pull',
): string {
  if (!isKnownDraftStatus(draft.status)) {
    return `草稿状态未识别（${draft.status}），请刷新后重试`
  }
  if (draft.status === 'syncing') {
    return '当前草稿正在同步处理中'
  }
  if (draft.status === 'conflict') {
    const hint = draft.conflictMessage || draft.conflictSummary
    if (hint) return `等待用户决定：${hint}`
    return '存在未解决的冲突，请先处理 Agent 提示的问题'
  }
  if (draft.syncStatus === 'awaiting_user') {
    return '等待用户输入决定后才能继续 Pull 或 Push'
  }
  if (draft.syncStatus === 'merge_conflict' || draft.syncStatus === 'validation_failed') {
    return syncProcessingLabel(draft.syncStatus)
  }
  if (draft.status === 'error') {
    const retryableSyncStatus =
      draft.syncStatus === 'clean' ||
      draft.syncStatus === 'dirty' ||
      draft.syncStatus == null
    const retryable =
      Boolean(draft.lastError) &&
      draft.pendingOperation === action &&
      retryableSyncStatus
    if (retryable) {
      return ''
    }
    return draft.lastError ? `同步失败：${draft.lastError}` : '上次同步失败，请查看错误信息后重试'
  }
  if (action === 'pull' && draft.syncStatus === 'dirty') {
    return ''
  }
  return ''
}

export function showConflictDecision(draft: SiteDraft): boolean {
  if (draft.status === 'conflict') return true
  return draft.syncStatus === 'awaiting_user'
}

export function conflictDecisionSummary(draft: SiteDraft): string {
  return (
    draft.conflictMessage ||
    draft.conflictSummary ||
    'Agent 需要你补充决定后才能继续同步。'
  )
}

export function pushSuccessMessage(
  draft: SiteDraft,
  publicUrl: string | null | undefined,
): string {
  if (!isKnownDraftStatus(draft.status) || draft.status !== 'active') return ''
  if (publicUrl) return `Push 成功，线上地址：${publicUrl}`
  return 'Push 已完成，草稿状态为就绪'
}

import type { DraftStatus, SiteDraft } from './types'

const STATUS_LABEL: Record<DraftStatus, string> = {
  ready: '就绪',
  syncing: '同步处理中',
  conflict: '等待用户决定',
  error: '同步失败',
}

export function draftStatusLabel(status: DraftStatus): string {
  return STATUS_LABEL[status]
}

export function formatCommitRef(commitId: string | null | undefined): string {
  if (!commitId) return '—'
  return commitId.slice(0, 7)
}

export function syncActionDisabledReason(
  draft: SiteDraft,
  action: 'push' | 'pull',
): string {
  if (draft.status === 'syncing') {
    return '当前草稿正在同步处理中'
  }
  if (draft.status === 'conflict') {
    if (action === 'pull') {
      return draft.conflictMessage
        ? `等待用户决定：${draft.conflictMessage}`
        : '存在未解决的冲突，请先处理 Agent 提示的问题'
    }
    return draft.conflictMessage
      ? `等待用户决定：${draft.conflictMessage}`
      : '存在未解决的冲突，请先处理 Agent 提示的问题'
  }
  if (draft.status === 'error') {
    return draft.lastError ? `同步失败：${draft.lastError}` : '上次同步失败，请查看错误信息后重试'
  }
  return ''
}

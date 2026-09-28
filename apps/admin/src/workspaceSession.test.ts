import { beforeEach, describe, expect, it } from 'vitest'
import {
  applySelectedDraftId,
  clearWorkspaceSession,
  currentUserState,
  selectedDraftIdState,
  setCurrentUser,
} from './workspaceSession'

describe('workspaceSession', () => {
  beforeEach(() => {
    localStorage.clear()
    clearWorkspaceSession()
  })

  it('applySelectedDraftId 同步 localStorage 与响应式状态', () => {
    applySelectedDraftId('draft-99')
    expect(selectedDraftIdState.value).toBe('draft-99')
    expect(localStorage.getItem('olps_draft_id')).toBe('draft-99')
  })

  it('setCurrentUser 更新共享用户状态', () => {
    setCurrentUser({ userId: 'u1', account: 'a', name: 'A' })
    expect(currentUserState.value?.account).toBe('a')
    clearWorkspaceSession()
    expect(currentUserState.value).toBeNull()
  })
})

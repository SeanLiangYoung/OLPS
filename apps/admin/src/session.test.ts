import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSession,
  getAccessToken,
  getSelectedDraftId,
  setAccessToken,
  setSelectedDraftId,
} from './session'

describe('session', () => {
  beforeEach(() => {
    localStorage.clear()
    clearSession()
  })

  it('保存并读取 accessToken', () => {
    setAccessToken('token-abc')
    expect(getAccessToken()).toBe('token-abc')
  })

  it('保存并读取当前草稿 draftId', () => {
    setSelectedDraftId('draft-1')
    expect(getSelectedDraftId()).toBe('draft-1')
  })

  it('clearSession 清除 token 与 draftId', () => {
    setAccessToken('t')
    setSelectedDraftId('d')
    clearSession()
    expect(getAccessToken()).toBe('')
    expect(getSelectedDraftId()).toBe('')
  })
})

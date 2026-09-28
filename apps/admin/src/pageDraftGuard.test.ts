import { describe, expect, it } from 'vitest'
import { pageDraftMismatchMessage } from './pageDraftGuard'

describe('pageDraftGuard', () => {
  it('页面 draftId 与当前草稿不一致时返回拒绝说明', () => {
    expect(pageDraftMismatchMessage('draft-b', 'draft-a')).toBe(
      '该页面属于其他草稿，请在工作区切换到对应草稿后再编辑',
    )
  })

  it('页面无 draftId 时不拦截', () => {
    expect(pageDraftMismatchMessage('draft-a', undefined)).toBe('')
    expect(pageDraftMismatchMessage('draft-a', null)).toBe('')
  })

  it('draftId 一致时不拦截', () => {
    expect(pageDraftMismatchMessage('draft-a', 'draft-a')).toBe('')
  })
})

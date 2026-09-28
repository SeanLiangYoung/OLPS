import { describe, expect, it } from 'vitest'
import { reconcilePageIdForSite } from './reportsPageSelection'

describe('reconcilePageIdForSite', () => {
  const pages = [{ pageId: 'p-new-1' }, { pageId: 'p-new-2' }]

  it('切换网站后清除不属于新网站的 pageId', () => {
    expect(reconcilePageIdForSite('p-old', pages)).toBe('p-new-1')
  })

  it('pageId 仍在新网站列表中时保留', () => {
    expect(reconcilePageIdForSite('p-new-2', pages)).toBe('p-new-2')
  })

  it('新网站无页面时清空', () => {
    expect(reconcilePageIdForSite('p-old', [])).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import { filterManagedPages, pageChangeLabel, publicationOperationLabel, rememberSiteDraft, recalledSiteDraft } from './siteManagement'

const pages = [
  { pageId: 'one', title: '产品介绍', slug: 'product', kind: 'site', locale: 'zh', operation: 'publish', onlineStatus: 'published', changed: true, updatedAt: '2026-10-26T01:00:00Z', issues: [] },
  { pageId: 'two', title: '英文案例', slug: 'case', kind: 'content', locale: 'en', operation: 'none', onlineStatus: 'published', changed: false, updatedAt: '2026-10-26T02:00:00Z', issues: [] },
  { pageId: 'three', title: '已删除的广告', slug: 'ad', kind: 'ads', locale: 'zh', operation: 'delete', onlineStatus: 'published', changed: true, updatedAt: '2026-10-26T03:00:00Z', issues: [] },
] as const

describe('网站页面管理', () => {
  it('根据搜索、类型、语言和更改状态组合筛选并保留删除操作', () => {
    expect(filterManagedPages([...pages], { search: '产品', kind: 'site', locale: 'zh', state: 'changed' }).map(p => p.pageId)).toEqual(['one'])
    expect(filterManagedPages([...pages], { search: '', kind: 'all', locale: '', state: 'changed' }).map(p => p.pageId)).toEqual(['three', 'one'])
    expect(filterManagedPages([...pages], { search: 'CASE', kind: 'all', locale: 'en', state: 'published' }).map(p => p.pageId)).toEqual(['two'])
  })
  it('分别描述线上与编辑内容，明确删除及停止展示', () => {
    expect(pageChangeLabel(pages[0])).toBe('有未发布更改')
    expect(pageChangeLabel(pages[1])).toBe('没有未发布更改')
    expect(pageChangeLabel(pages[2])).toBe('等待删除')
    expect(publicationOperationLabel('unpublish')).toBe('停止展示')
  })
  it('支持按照标题与编辑时间调整列表顺序', () => {
    const filters = { search: '', kind: 'all', locale: '', state: 'all' }
    expect(filterManagedPages([...pages], { ...filters, sort: 'oldest' }).map(page => page.pageId)).toEqual(['one', 'two', 'three'])
    expect(filterManagedPages([...pages], { ...filters, sort: 'title' }).map(page => page.title)).toEqual([...pages].map(page => page.title).sort((a, b) => a.localeCompare(b, 'zh-CN')))
  })
  it('只恢复仍有权限访问的网站编辑版本', () => {
    localStorage.clear()
    rememberSiteDraft('site-one', 'draft-two')
    expect(recalledSiteDraft('site-one', [{ draftId: 'draft-two' }])).toBe('draft-two')
    expect(recalledSiteDraft('site-one', [{ draftId: 'draft-three' }])).toBe('')
  })
})

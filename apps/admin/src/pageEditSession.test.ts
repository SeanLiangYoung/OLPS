import { describe, expect, it } from 'vitest'
import { applySavedPageMetadata, pageEditSnapshot, protectPageUnload, PageEditSession } from './pageEditSession'
import type { PageRecord } from './types'

function pageRecord(): PageRecord {
  return {
    pageId: 'page-a', kind: 'ads', title: '当前标题', slug: 'page-a', status: 'draft',
    seo: { title: '当前 SEO', description: '当前描述' }, updatedAt: 'before',
    body: { html: '当前 HTML', ads: {
      keywordCluster: ['keyword'], screens: [{ screenId: 'entry', role: 'entry', title: '当前屏标题', html: '当前屏 HTML' }],
      guide: { entryByKeyword: { keyword: 'entry' }, nodes: { entry: { options: [{ id: 'option', label: '当前选项', action: 'go_cta' }] } } },
    } },
  }
}

describe('页面编辑响应处理', () => {
  it.each(['slug', 'locale', 'translationGroupId'] as const)('修改 %s 后保留离开提醒，保存 Guide 保留该修改状态', (field) => {
    const current = pageRecord()
    const session = new PageEditSession()
    session.acceptSaved(pageEditSnapshot(current))
    current[field] = 'updated-value'
    expect(session.needsLeaveWarning(current)).toBe(true)
    session.acceptSaved(pageEditSnapshot(current), 'guide')
    expect(session.hasUnsaved(current)).toBe(true)
    session.acceptSaved(pageEditSnapshot(current))
    expect(session.hasUnsaved(current)).toBe(false)
  })
  it('有未保存修改或保存进行中才阻止浏览器关闭', () => {
    const current = pageRecord()
    const session = new PageEditSession()
    session.acceptSaved(pageEditSnapshot(current))
    const savedEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    protectPageUnload(savedEvent, session.needsLeaveWarning(current))
    expect(savedEvent.defaultPrevented).toBe(false)
    current.title = '未保存标题'
    const dirtyEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    protectPageUnload(dirtyEvent, session.needsLeaveWarning(current))
    expect(dirtyEvent.defaultPrevented).toBe(true)
    current.title = '当前标题'
    const operation = session.begin()!
    expect(session.needsLeaveWarning(current)).toBe(true)
    session.finish(operation)
    expect(session.needsLeaveWarning(current)).toBe(false)
  })
  it('初次载入已保存，编辑和恢复原值更新未保存状态', () => {
    const current = pageRecord()
    const session = new PageEditSession()
    session.acceptSaved(pageEditSnapshot(current))
    expect(session.saveStatus(current)).toBe('已保存')
    current.seo.title = '修改 SEO'
    expect(session.saveStatus(current)).toBe('有未保存修改')
    current.seo.title = '当前 SEO'
    expect(session.hasUnsaved(current)).toBe(false)
  })

  it('Guide 保存保留正文 SEO 的未保存状态', () => {
    const current = pageRecord()
    const session = new PageEditSession()
    session.acceptSaved(pageEditSnapshot(current))
    current.body.html = '修改正文'
    current.seo.description = '修改 SEO'
    current.body.ads!.guide.nodes.entry!.options[0]!.label = '修改 Guide'
    session.acceptSaved(pageEditSnapshot(current), 'guide')
    expect(session.saveStatus(current)).toBe('有未保存修改')
    current.body.html = '当前 HTML'
    current.seo.description = '当前描述'
    expect(session.hasUnsaved(current)).toBe(false)
  })

  it('全部保存只确认已提交内容，请求期间新输入继续未保存', () => {
    const current = pageRecord()
    const session = new PageEditSession()
    session.acceptSaved(pageEditSnapshot(current))
    current.title = '提交标题'
    const sent = pageEditSnapshot(current)
    const operation = session.begin()!
    expect(session.saveStatus(current)).toBe('正在保存…')
    current.title = '请求期间输入'
    session.acceptSaved(sent)
    session.finish(operation)
    expect(session.saveStatus(current)).toBe('有未保存修改')
  })

  it('Guide 请求期间的新输入继续未保存', () => {
    const current = pageRecord()
    const session = new PageEditSession()
    session.acceptSaved(pageEditSnapshot(current))
    current.body.ads!.guide.nodes.entry!.options[0]!.label = '提交 Guide'
    const sent = pageEditSnapshot(current)
    current.body.ads!.guide.nodes.entry!.options[0]!.label = '新 Guide 输入'
    session.acceptSaved(sent, 'guide')
    expect(session.hasUnsaved(current)).toBe(true)
  })

  it('保存失败保留输入，重试成功显示已保存', () => {
    const current = pageRecord()
    const session = new PageEditSession()
    session.acceptSaved(pageEditSnapshot(current))
    current.body.html = '需要重试的输入'
    const operation = session.begin()!
    session.saveFailed = true
    session.finish(operation)
    expect(session.saveStatus(current)).toBe('保存失败，输入已保留，请重试')
    expect(session.hasUnsaved(current)).toBe(true)
    expect(current.body.html).toBe('需要重试的输入')
    const retry = session.begin()!
    session.acceptSaved(pageEditSnapshot(current))
    session.finish(retry)
    expect(session.saveStatus(current)).toBe('已保存')
  })

  it('切换页面清除失败状态和旧保存记录', () => {
    const session = new PageEditSession()
    session.acceptSaved(pageEditSnapshot(pageRecord()))
    session.saveFailed = true
    session.reset()
    expect(session.saveFailed).toBe(false)
    expect(session.hasUnsaved(pageRecord())).toBe(false)
  })
  it('保存响应保留全部当前编辑和请求期间的新输入', () => {
    const current = pageRecord()
    const saved = structuredClone(current)
    saved.updatedAt = 'after'
    current.title = '新标题'
    current.seo.description = '新描述'
    current.body.html = '新 HTML'
    current.body.ads!.screens[0]!.html = '新屏 HTML'
    current.body.ads!.guide.nodes.entry!.options[0]!.label = '新选项'
    const expected = structuredClone(current)
    expected.updatedAt = 'after'
    applySavedPageMetadata(current, saved)
    expect(current).toEqual(expected)
  })

  it('统一阻止交叉操作，旧操作结束不能释放新页面的操作', () => {
    const session = new PageEditSession()
    const oldOperation = session.begin()!
    expect(session.begin()).toBeNull()
    session.reset()
    const newOperation = session.begin()!
    expect(session.isCurrent(oldOperation)).toBe(false)
    session.finish(oldOperation)
    expect(session.pending).toBe(true)
    session.finish(newOperation)
    expect(session.pending).toBe(false)
  })

  it('页面切换和重复加载使旧响应失效', () => {
    const session = new PageEditSession()
    const firstLoad = session.reset()
    const secondLoad = session.reset()
    expect(session.isCurrent(firstLoad)).toBe(false)
    expect(session.isCurrent(secondLoad)).toBe(true)
  })

  it('不接受其他页面的保存响应', () => {
    const current = pageRecord()
    expect(() => applySavedPageMetadata(current, { ...current, pageId: 'page-b' })).toThrow('pageId')
  })
})

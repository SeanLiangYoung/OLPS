import { describe, expect, it } from 'vitest'
import type { AdsPayload } from '../types'
import { HtmlDocument } from './document'
import { duplicateRegion, updateGuideLabel, removeRegion } from './guide-operations'

function adsPayload(html: string): AdsPayload {
  return { keywordCluster: ['product'], screens: [{ screenId: 'entry', role: 'entry', title: '入口', html }, { screenId: 'cta', role: 'cta', title: '询盘', html: '<form data-olps-inquiry></form>' }], guide: { entryByKeyword: { product: 'entry' }, nodes: { entry: { options: [{ id: 'go', label: '联系', action: 'go_cta' }] }, cta: { options: [] } } } }
}

describe('Guide 区域编辑', () => {
  it('复制按钮生成独立 GuideOption 标识并保留目标', () => {
    const html = '<section id="intro"><button data-guide-option="go">联系</button><a href="#outside">外部区域</a></section><section id="outside">目标</section>'
    const key = new HtmlDocument(html).nodes[0]!.key
    const result = duplicateRegion(html, key, adsPayload(html), 'entry')
    const parsed = new DOMParser().parseFromString(result.html, 'text/html')
    const options = result.ads!.guide.nodes.entry!.options
    expect(options).toHaveLength(2)
    expect(options[1]!.id).not.toBe('go')
    expect(options[1]!.action).toBe('go_cta')
    expect(parsed.querySelectorAll('[data-guide-option]')[1]!.getAttribute('data-guide-option')).toBe(options[1]!.id)
    expect(parsed.querySelectorAll('a')[1]!.getAttribute('href')).toBe('#outside')
  })
  it('抽屉修改文字同步明确映射的 HTML 按钮', () => {
    const html = '<button data-olps-guide-option="go"><strong>联系</strong></button>'
    const result = updateGuideLabel(html, adsPayload(html), 'entry', 'go', '发送询盘')
    expect(result.ads.guide.nodes.entry!.options[0]!.label).toBe('发送询盘')
    expect(new DOMParser().parseFromString(result.html, 'text/html').querySelector('button')!.textContent).toBe('发送询盘')
  })
  it('缺少明确的 GuideOption 映射时拒绝复制并保持原文', () => {
    const html = '<section><button data-guide-option="unknown">未知</button></section>'
    expect(() => duplicateRegion(html, '0', adsPayload(html), 'entry')).toThrow('unknown')
  })
  it('删除按钮只更新当前屏并保留其他屏的同名选项', () => {
    const html = '<section><button data-guide-option="go">联系</button></section>'
    const ads = adsPayload(html)
    ads.guide.nodes.other = { options: [{ id: 'go', label: '其他入口', action: 'go_cta' }] }
    const result = removeRegion(html, '0', ads, 'entry', { confirmSystem: true })
    expect(result.ads!.guide.nodes.entry!.options).toHaveLength(0)
    expect(result.ads!.guide.nodes.other!.options).toHaveLength(1)
    expect(result.html).toBe('')
  })
})

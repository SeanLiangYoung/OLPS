import { describe, expect, it } from 'vitest'
import { defaultSiteSettings } from '@olps/domain'
import { assertValidAdsPage } from './page-validation.js'
import type { StoredPageJson } from './types.js'

function page(html: string): StoredPageJson {
  return { pageId: 'ads', kind: 'ads', slug: 'ads', title: '广告', locale: 'en', status: 'draft', seo: { title: '广告', description: '广告' }, body: { html: '<div id="olps-ads-root"></div>', ads: {
    keywordCluster: ['alpha'], screens: [
      { screenId: 'entry', role: 'entry', title: '入口', html, entryFor: ['alpha'] },
      { screenId: 'cta', role: 'cta', title: '询盘', html: '<h2>询盘</h2>' },
    ], guide: { entryByKeyword: { alpha: 'entry' }, nodes: { entry: { options: [{ id: 'contact', label: '联系', action: 'go_cta' }] }, cta: { options: [] } } },
  } } }
}


describe('公开 Guide HTML 引用检查', () => {
  for (const attribute of ['data-guide-option', 'data-olps-guide-option']) {
    it(`拒绝 ${attribute} 引用当前屏幕不存在的选项`, () => {
      expect(() => assertValidAdsPage(page(`<button ${attribute}="missing">联系</button>`), defaultSiteSettings())).toThrow('missing')
    })
    it(`允许 ${attribute} 引用当前屏幕选项`, () => {
      expect(() => assertValidAdsPage(page(`<button ${attribute}="contact">联系</button>`), defaultSiteSettings())).not.toThrow()
    })
  }
})

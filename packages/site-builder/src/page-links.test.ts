import { describe, expect, it } from 'vitest'
import { rewritePageLinks } from './page-links.js'
import type { StoredPageJson } from './types.js'

const target: StoredPageJson = { pageId: 'target', title: '产品', slug: 'zh/product', kind: 'site', locale: 'zh', status: 'published', seo: { title: '产品', description: '产品介绍' }, body: { html: '<h1>产品</h1>' } }
describe('编辑器页面关联链接', () => {
  it('根据最终公开页面和部署地址更新链接，保留其他链接', () => {
    const output = rewritePageLinks('<a data-olps-page-link="target" href="/old/">产品</a><a href="https://example.com">外部</a>', { publicSiteUrl: 'https://example.org/s/site-one/' }, [target])
    expect(output).toContain('href="/s/site-one/zh/product/"')
    expect(output).toContain('href="https://example.com"')
  })
  it('无法发布不存在的关联页面', () => {
    expect(() => rewritePageLinks('<a data-olps-page-link="missing">链接</a>', {}, [target])).toThrow('关联页面不存在')
  })
})

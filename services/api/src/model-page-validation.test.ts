import { describe, expect, it } from 'vitest'
import { validateGeneratedPage } from './model-page-validation.js'
import { generatePageContent } from './generate.js'

describe('模型生成结果验证', () => {
  const input = { kind: 'site' as const, title: '首页', slug: 'home', locale: 'zh-CN' }
  it('拒绝只有标题的正文', () => {
    expect(() => validateGeneratedPage({
      title: '首页', seo: { title: '首页', description: '企业介绍' },
      body: { html: '<h1>首页</h1>' },
    }, input)).toThrow()
  })
  it('广告正文需要真实根元素和包含联系字段的询盘表单', () => {
    const page = generatePageContent({ ...input, kind: 'ads', brief: '产品咨询', keywords: ['products', 'materials'] })
    const adsInput = { ...input, kind: 'ads' as const }
    expect(() => validateGeneratedPage({ ...page, body: { ...page.body, html: '<h1>产品咨询</h1>' } }, adsInput)).toThrow()
    const cta = page.body.ads!.screens.find(screen => screen.role === 'cta')!
    cta.html = '<div>data-olps-inquiry</div>'
    expect(() => validateGeneratedPage(page, adsInput)).toThrow()
  })
  it('拒绝无效 Guide，完整正文和 SEO 可写入草稿', () => {
    const html = '<!doctype html><html lang="zh-CN"><head><title>企业介绍</title></head><body><header>企业介绍</header><main><h1>橡胶产品</h1><section><h2>产品应用</h2><p>' + '我们提供用于工业设备的橡胶产品，支持按照规格选择材料、尺寸和使用环境。'.repeat(6) + '</p></section><section><h2>联系我们</h2><a href="mailto:sales@example.com">咨询产品</a></section></main><footer>联系方式</footer></body></html>'
    const output = validateGeneratedPage({ title: '橡胶产品', seo: { title: '橡胶产品', description: '工业橡胶产品介绍和咨询' }, body: { html } }, input)
    expect(output.slug).toBe('home')
    expect(output.locale).toBe('zh-CN')
    expect(output.body.html).toContain('产品应用')
    expect(() => validateGeneratedPage({ title: '广告', seo: output.seo, body: { html, ads: { screens: [], keywordCluster: ['a', 'b'], guide: { entryByKeyword: {}, nodes: {} } } } }, { ...input, kind: 'ads' })).toThrow()
  })
})

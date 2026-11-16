import { describe, expect, it } from 'vitest'
import { HtmlDocument } from './document'

describe('历史资源画布预览', () => {
  it('替换图片、picture、srcset、CSS 和 stylesheet 的授权副本地址', () => {
    const html = '<link rel="stylesheet" href="/assets/site.css"><style>.hero{background:url("/assets/logo.png")}</style><section style="background-image:url(assets/logo.png)"><picture><source srcset="/assets/logo.png 1x, /assets/large.png 2x"><img src="/assets/logo.png" srcset="/assets/large.png 2x"></picture></section>'
    const resources = [{ url: '/assets/logo.png', previewUrl: '/api/resources/logo?token=one' }, { url: '/assets/large.png', previewUrl: '/api/resources/large?token=two' }, { url: '/assets/site.css', previewUrl: '/api/resources/css?token=three' }]
    const doc = new HtmlDocument(html)
    const canvas = new DOMParser().parseFromString(doc.canvasHtml(resources), 'text/html')
    expect(canvas.querySelector('img')!.getAttribute('src')).toBe(resources[0]!.previewUrl)
    expect(canvas.querySelector('img')!.getAttribute('srcset')).toContain(resources[1]!.previewUrl)
    expect(canvas.querySelector('source')!.getAttribute('srcset')).toContain(resources[0]!.previewUrl)
    expect(canvas.querySelector('source')!.getAttribute('srcset')).toContain(resources[1]!.previewUrl)
    expect(canvas.querySelector('link')!.getAttribute('href')).toBe(resources[2]!.previewUrl)
    expect(canvas.querySelector('style')!.textContent).toContain(resources[0]!.previewUrl)
    expect(canvas.querySelector('section')!.getAttribute('style')).toContain(resources[0]!.previewUrl)
    expect(doc.html).toBe(html)
  })
  it('CSS import 字符串和图片片段继续引用正确资源', () => {
    const html = '<style>@import "/assets/base.css"; .icon{background:url("/assets/icons.svg#contact")}</style>'
    const canvas = new HtmlDocument(html).canvasHtml([{ url: '/assets/base.css', previewUrl: '/api/base?token=one' }, { url: '/assets/icons.svg', previewUrl: '/api/icons?token=two' }])
    expect(canvas).toContain('/api/base?token=one')
    expect(canvas).toContain('/api/icons?token=two#contact')
  })
})

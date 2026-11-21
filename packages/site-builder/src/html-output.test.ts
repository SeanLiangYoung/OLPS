import { expect, it } from 'vitest'
import { makeCssPortable, makeHtmlPortable } from './portable-html.js'

it('正文链接、图片和 CSS 使用相对地址，SEO 保留绝对地址', () => {
  const html = makeHtmlPortable('<html><head><link rel="canonical" href="https://example.com/en/about/"><link rel="stylesheet" href="/assets/theme/main.css"></head><body><a href="/en/privacy/">Privacy</a><img src="/assets/logo.png" srcset="/assets/logo.png 1x, /assets/logo@2x.png 2x"><div style="background:url(/assets/logo.png)"></div></body></html>', 'en/about/index.html')
  expect(html).toContain('href="https://example.com/en/about/"')
  expect(html).toContain('href="../../assets/theme/main.css"')
  expect(html).toContain('href="../privacy/"')
  expect(html).toContain('src="../../assets/logo.png"')
  expect(html).toContain('../../assets/logo@2x.png 2x')
  expect(html).toContain('../../assets/logo.png')
})

it('独立 CSS 根目录资源从 CSS 文件所在目录解析', () => {
  expect(makeCssPortable('body{background:url("/assets/uploads/logo.png")}', 'assets/theme/starter/style.css')).toContain('../../uploads/logo.png')
})

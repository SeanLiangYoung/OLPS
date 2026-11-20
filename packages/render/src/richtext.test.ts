import { describe, expect, it } from 'vitest'
import { renderRichtext, sanitizeRichHtml } from './richtext.js'

describe('富文本白名单', () => {
  it('移除 script 标签', () => {
    const html = sanitizeRichHtml('<p>safe</p><script>alert(1)</script><p>ok</p>')
    expect(html).toContain('<p>safe</p>')
    expect(html).toContain('<p>ok</p>')
    expect(html.toLowerCase()).not.toContain('<script')
  })

  it('移除事件属性', () => {
    const html = sanitizeRichHtml('<p onclick="alert(1)" onmouseover="x()">text</p>')
    expect(html).toContain('text')
    expect(html.toLowerCase()).not.toContain('onclick')
    expect(html.toLowerCase()).not.toContain('onmouseover')
  })

  it('安全链接处理：拒绝 javascript 协议', () => {
    const html = renderRichtext({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'javascript:alert(1)',
                  },
                },
              ],
            },
          ],
        },
      ],
    })
    expect(html.toLowerCase()).not.toContain('javascript:')
    expect(html).toContain('click')
  })
})

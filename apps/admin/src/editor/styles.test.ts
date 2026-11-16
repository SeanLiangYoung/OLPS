import { describe, expect, it } from 'vitest'
import { HtmlDocument } from './document'
import { setElementStyle, elementStyleValues, editorMetadata } from './styles'

describe('设备样式', () => {
  it('当前手机样式保留原有样式与桌面基础属性', () => {
    const original = '<style>@media(max-width:599px){.product{padding:12px}}</style><section class="product" style="width: 420px; color: red"><p>内容</p></section>'
    const key = new HtmlDocument(original).nodes.find(node => node.tag === 'section')!.key
    const changed = setElementStyle(original, key, 'width', '280px', 'mobile')
    expect(changed.html).toContain('<style>@media(max-width:599px){.product{padding:12px}}</style>')
    expect(changed.html).toContain('max-width: 599px')
    expect(changed.html).toContain('420px')
    expect(changed.html).toContain('280px')
    expect(changed.elementId).toBeTruthy()
    const node = new HtmlDocument(changed.html).nodes.find(node => node.tag === 'section')!
    expect(elementStyleValues(changed.html, node.key, 'mobile').width).toBe('280px')
    expect(elementStyleValues(changed.html, node.key, 'all').width).toBe('420px')
  })
  it('三个设备分别设置并在重新读取后保留同一个标识', () => {
    let html = '<div id="region">内容</div>'
    const ids = []
    for (const [scope, width] of [['desktop', '900px'], ['tablet', '600px'], ['mobile', '300px']] as const) {
      const key = new HtmlDocument(html).nodes.find(node => node.tag === 'div')!.key
      const changed = setElementStyle(html, key, 'width', width, scope)
      html = changed.html
      ids.push(changed.elementId)
    }
    expect(new Set(ids).size).toBe(1)
    const key = new HtmlDocument(html).nodes.find(node => node.tag === 'div')!.key
    expect(elementStyleValues(html, key, 'desktop').width).toBe('900px')
    expect(elementStyleValues(html, key, 'tablet').width).toBe('600px')
    expect(elementStyleValues(html, key, 'mobile').width).toBe('300px')
    expect(editorMetadata([html])).toEqual({ version: 1, elementIds: [ids[0]] })
  })
  it('修改同一设备属性不会增加重复规则', () => {
    let html = '<p>内容</p>'
    for (const width of ['300px', '320px']) {
      const key = new HtmlDocument(html).nodes.find(node => node.tag === 'p')!.key
      html = setElementStyle(html, key, 'width', width, 'mobile').html
    }
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    expect(parsed.querySelectorAll('style[data-olps-editor-style]')).toHaveLength(1)
    expect(parsed.querySelector('style')!.textContent).toContain('320px')
    expect(parsed.querySelector('style')!.textContent).not.toContain('300px')
  })
  it('复制区域生成独立样式标识与相同设备规则', () => {
    const changed = setElementStyle('<section>内容</section>', '0', 'width', '280px', 'mobile')
    const model = new HtmlDocument(changed.html)
    model.duplicate(model.nodes.find(node => node.tag === 'section')!.key)
    const parsed = new DOMParser().parseFromString(model.html, 'text/html')
    const sections = parsed.querySelectorAll('section')
    const copiedId = sections[1]!.getAttribute('data-olps-style')!
    expect(copiedId).not.toBe(changed.elementId)
    expect(parsed.querySelector(`style[data-olps-editor-style="${copiedId}"]`)!.textContent).toContain(copiedId)
    expect(parsed.querySelector(`style[data-olps-editor-style="${copiedId}"]`)!.textContent).toContain('280px')
  })
})

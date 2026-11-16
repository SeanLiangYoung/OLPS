import { describe, expect, it } from 'vitest'
import { HtmlDocument } from './document'

const original = `<style>.hero{color:red}</style>\n<section id='hero'><h1>Hello</h1><img src="old.png" srcset="old@2.png 2x"><script>window.secret=1</script><custom-widget data-value='keep'></custom-widget></section>`

describe('HTML 局部编辑', () => {
  it('保持未修改正文完全一致', () => {
    expect(new HtmlDocument(original).html).toBe(original)
  })
  it('修改文字时完整保留其余原文', () => {
    const doc = new HtmlDocument(original)
    doc.text(doc.nodes.find(node => node.tag === 'h1')!.key, '你好 <世界>')
    expect(doc.html).toBe(original.replace('Hello', '你好 &lt;世界&gt;'))
  })
  it('画布禁用脚本及事件处理并保留存储原文', () => {
    const doc = new HtmlDocument('<a onclick="alert(1)" href="javascript:alert(1)">内容</a><script>window.secret=1</script>')
    const canvas = doc.canvasHtml()
    expect(canvas).not.toContain('onclick')
    expect(canvas).not.toContain('javascript:')
    expect(canvas).not.toContain('<script')
    expect(doc.html).toContain('<script>window.secret=1</script>')
  })
  it('替换图片同时更新 picture 来源', () => {
    const doc = new HtmlDocument('<picture><source srcset="old.webp"><img src="old.png" srcset="old2.png 2x" alt="图片"></picture>')
    doc.image(doc.nodes.find(node => node.tag === 'img')!.key, '/assets/new.png')
    expect(doc.html).not.toContain('old')
    expect(doc.html).toContain('/assets/new.png')
  })
  it('复制区域重新生成内部标识及引用', () => {
    const doc = new HtmlDocument('<section id="area"><label for="email">邮箱</label><input id="email"><a href="#email">链接</a></section>')
    doc.duplicate(doc.nodes.find(node => node.tag === 'section')!.key)
    const parsed = new DOMParser().parseFromString(doc.html, 'text/html')
    const sections = parsed.querySelectorAll('section')
    expect(sections).toHaveLength(2)
    expect(sections[1]!.id).not.toBe('area')
    expect(sections[1]!.querySelector('label')!.htmlFor).toBe(sections[1]!.querySelector('input')!.id)
    expect(sections[1]!.querySelector('a')!.getAttribute('href')).toBe('#' + sections[1]!.querySelector('input')!.id)
  })
  it('系统组件删除需要明确处理', () => {
    const doc = new HtmlDocument('<section><form data-olps-inquiry><input name="email"></form></section>')
    expect(() => doc.remove(doc.nodes.find(node => node.tag === 'section')!.key)).toThrow('询盘')
  })
  it('自闭合标签添加属性保持有效', () => {
    const doc = new HtmlDocument('<img src="old.png"/>')
    doc.attributes(doc.nodes[0]!.key, { alt: '产品' })
    expect(doc.html).toBe('<img src="old.png" alt="产品"/>')
  })
  it('按钮链接使用可点击的 anchor 并保留样式', () => {
    const doc = new HtmlDocument('<button class="action" style="color:red">咨询</button>')
    doc.link(doc.nodes[0]!.key, '/contact/', 'contact-page')
    const element = new DOMParser().parseFromString(doc.html, 'text/html').querySelector('a')!
    expect(element.getAttribute('href')).toBe('/contact/')
    expect(element.className).toBe('action')
    expect(element.textContent).toBe('咨询')
    expect(element.getAttribute('data-olps-page-link')).toBe('contact-page')
  })
  it('图片链接包裹图片并保持来源', () => {
    const doc = new HtmlDocument('<img src="product.png" alt="产品">')
    doc.link(doc.nodes[0]!.key, 'https://example.com/product')
    const element = new DOMParser().parseFromString(doc.html, 'text/html').querySelector('a img')!
    expect(element.getAttribute('src')).toBe('product.png')
  })
  it('修改标题级别保持内容和属性', () => {
    const doc = new HtmlDocument('<h2 class="title">介绍<span>产品</span></h2>')
    doc.tag(doc.nodes[0]!.key, 'h3')
    expect(doc.html).toBe('<h3 class="title">介绍<span>产品</span></h3>')
  })
  it('复制询盘区域保留系统组件并生成内部标识', () => {
    const doc = new HtmlDocument('<section id="contact"><form data-olps-inquiry><label for="mail">邮箱</label><input id="mail" name="email"></form></section>')
    doc.duplicate(doc.nodes[0]!.key)
    const parsed = new DOMParser().parseFromString(doc.html, 'text/html')
    expect(parsed.querySelectorAll('form[data-olps-inquiry]')).toHaveLength(2)
    expect(parsed.querySelectorAll('input')[1]!.id).not.toBe('mail')
  })
  it('确认删除系统区域时处理外部引用', () => {
    const doc = new HtmlDocument('<a href="#contact">联系</a><section id="contact"><form data-olps-inquiry></form></section><section id="replacement">替代区域</section>')
    const key = doc.nodes.find(node => node.tag === 'section')!.key
    doc.remove(key, { confirmSystem: true, replacementId: 'replacement' })
    expect(doc.html).toBe('<a href="#replacement">联系</a><section id="replacement">替代区域</section>')
  })
})

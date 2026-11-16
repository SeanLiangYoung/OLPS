import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { rewritePreviewResources } from './resource-preview'

type ElementNode = DefaultTreeAdapterMap['element']
export type EditableNode = { key: string; tag: string; label: string; parent?: string; depth: number; element: ElementNode }

function escapeText(value: string): string {
  const node = document.createElement('span')
  node.textContent = value
  return node.innerHTML
}

export class HtmlDocument {
  html: string
  nodes: EditableNode[] = []

  constructor(html: string) {
    this.html = html
    const root = parseFragment(html, { sourceCodeLocationInfo: true })
    const visit = (children: DefaultTreeAdapterMap['childNode'][], parent?: string, depth = 0) => {
      for (const child of children) {
        if (!('tagName' in child)) continue
        const location = child.sourceCodeLocation
        if (!location) continue
        const key = String(location.startOffset)
        const element = child as ElementNode
        const title = element.attrs.find(attr => attr.name === 'aria-label' || attr.name === 'id')?.value
        this.nodes.push({ key, tag: element.tagName, label: title || element.tagName, parent, depth, element })
        visit(element.childNodes, key, depth + 1)
      }
    }
    visit(root.childNodes)
  }

  node(key: string): EditableNode {
    const node = this.nodes.find(item => item.key === key)
    if (!node) throw new Error('选中内容已经变化，请重新选择')
    return node
  }

  source(key: string): string {
    const location = this.node(key).element.sourceCodeLocation!
    return this.html.slice(location.startOffset, location.endOffset)
  }

  replace(key: string, value: string): void {
    const location = this.node(key).element.sourceCodeLocation!
    this.html = this.html.slice(0, location.startOffset) + value + this.html.slice(location.endOffset)
  }

  attributes(key: string, values: Record<string, string | null>): void {
    const node = this.node(key)
    const location = node.element.sourceCodeLocation!
    if (!location.startTag) throw new Error('当前元素没有可编辑的 HTML 标签')
    const insertion = location.startTag.endOffset - (this.html[location.startTag.endOffset - 2] === '/' ? 2 : 1)
    const changes: { start: number; end: number; value: string }[] = []
    for (const [name, value] of Object.entries(values)) {
      if (name.startsWith('on') || name.startsWith('data-editor-')) throw new Error('事件属性由系统维护')
      const attr = location.attrs?.[name]
      const encoded = value === null ? '' : `${name}="${escapeText(value).replaceAll('"', '&quot;')}"`
      if (attr) changes.push({ start: attr.startOffset, end: attr.endOffset, value: encoded })
      else if (value !== null) changes.push({ start: insertion, end: insertion, value: ' ' + encoded })
    }
    for (const change of changes.sort((a, b) => b.start - a.start)) {
      this.html = this.html.slice(0, change.start) + change.value + this.html.slice(change.end)
    }
  }

  text(key: string, value: string): void {
    const element = this.node(key).element
    if (element.childNodes.some(child => 'tagName' in child)) throw new Error('该内容包含嵌套元素，请选择内部文字或使用高级 HTML')
    const location = element.sourceCodeLocation!
    if (!location.startTag || !location.endTag) throw new Error('当前元素不支持文字编辑')
    this.html = this.html.slice(0, location.startTag.endOffset) + escapeText(value) + this.html.slice(location.endTag.startOffset)
  }

  image(key: string, url: string): void {
    const node = this.node(key)
    const parent = node.parent && this.node(node.parent)
    if (parent && parent.tag === 'picture') {
      const container = document.createElement('template')
      container.innerHTML = this.source(parent.key)
      container.content.querySelectorAll('source').forEach(source => { source.srcset = url; source.removeAttribute('sizes') })
      const image = container.content.querySelector('img')!
      image.src = url
      image.removeAttribute('srcset')
      image.removeAttribute('sizes')
      this.replace(parent.key, container.innerHTML)
    } else this.attributes(key, { src: url, srcset: null, sizes: null })
  }

  tag(key: string, tagName: string): void {
    if (!['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a'].includes(tagName)) throw new Error('不支持该元素类型')
    const template = document.createElement('template')
    template.innerHTML = this.source(key)
    const original = template.content.firstElementChild!
    const replacement = document.createElement(tagName)
    for (const attr of Array.from(original.attributes)) replacement.setAttribute(attr.name, attr.value)
    replacement.innerHTML = original.innerHTML
    this.replace(key, replacement.outerHTML)
  }

  link(key: string, href: string, pageId?: string): void {
    const url = new URL(href || '#', 'https://editor.local')
    if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) throw new Error('链接地址仅支持网址、邮箱、电话或页面内部位置')
    let node = this.node(key)
    if (node.tag === 'a') { this.attributes(key, { href, 'data-olps-page-link': pageId || null }); return }
    if (node.parent && this.node(node.parent).tag === 'a') { this.attributes(node.parent, { href, 'data-olps-page-link': pageId || null }); return }
    const template = document.createElement('template')
    template.innerHTML = this.source(key)
    const original = template.content.firstElementChild!
    let ancestor = node.parent ? this.node(node.parent) : undefined
    while (ancestor) {
      if (ancestor.tag === 'form') throw new Error('询盘提交按钮由系统管理')
      ancestor = ancestor.parent ? this.node(ancestor.parent) : undefined
    }
    const anchor = document.createElement('a')
    anchor.setAttribute('href', href)
    if (pageId) anchor.setAttribute('data-olps-page-link', pageId)
    if (node.tag === 'button') {
      for (const attribute of Array.from(original.attributes)) {
        if (!['href', 'data-olps-page-link', 'type', 'disabled', 'name', 'value', 'form', 'formaction', 'formmethod'].includes(attribute.name)) anchor.setAttribute(attribute.name, attribute.value)
      }
      anchor.innerHTML = original.innerHTML
    } else anchor.append(original)
    this.replace(key, anchor.outerHTML)
  }

  duplicate(key: string): { guideOptions: Record<string, string>; styleIds: Record<string, string> } {
    const template = document.createElement('template')
    template.innerHTML = this.source(key)
    if (template.content.querySelector('#olps-ads-root')) throw new Error('广告页面入口需要保持唯一')
    const guideOptions: Record<string, string> = {}
    const styleIds: Record<string, string> = {}
    template.content.querySelectorAll('[data-guide-option],[data-olps-guide-option]').forEach(element => {
      for (const attribute of ['data-guide-option', 'data-olps-guide-option']) {
        const id = element.getAttribute(attribute)
        if (!id) continue
        guideOptions[id] ||= `option-${crypto.randomUUID()}`
        element.setAttribute(attribute, guideOptions[id]!)
      }
    })
    template.content.querySelectorAll('[data-olps-style]').forEach(element => {
      const id = element.getAttribute('data-olps-style')!
      styleIds[id] ||= crypto.randomUUID()
      element.setAttribute('data-olps-style', styleIds[id]!)
    })
    const mapping = new Map<string, string>()
    template.content.querySelectorAll('[id]').forEach(element => {
      const id = element.id + '-' + crypto.randomUUID().slice(0, 8)
      mapping.set(element.id, id)
      element.id = id
    })
    template.content.querySelectorAll('*').forEach(element => {
      for (const attribute of ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls']) {
        const value = element.getAttribute(attribute)
        if (value) element.setAttribute(attribute, value.split(' ').map(id => mapping.get(id) || id).join(' '))
      }
      const href = element.getAttribute('href')
      if (href?.startsWith('#') && mapping.has(href.slice(1))) element.setAttribute('href', '#' + mapping.get(href.slice(1)))
    })
    this.replace(key, this.source(key) + template.innerHTML)
    for (const node of this.nodes.filter(item => item.tag === 'style')) {
      const id = node.element.attrs.find(attr => attr.name === 'data-olps-editor-style')?.value
      if (!id || !styleIds[id]) continue
      const stylesheet = new CSSStyleSheet()
      stylesheet.insertRule(node.element.childNodes.map(child => 'value' in child ? child.value : '').join(''), 0)
      const rootRule = stylesheet.cssRules[0]!
      const rule = rootRule.type === CSSRule.MEDIA_RULE ? (rootRule as CSSMediaRule).cssRules[0] as CSSStyleRule : rootRule as CSSStyleRule
      rule.selectorText = rule.selectorText.replaceAll(id, styleIds[id]!)
      const style = document.createElement('style')
      for (const attr of node.element.attrs) style.setAttribute(attr.name, attr.name === 'data-olps-editor-style' ? styleIds[id]! : attr.value)
      style.textContent = stylesheet.cssRules[0]!.cssText
      this.html += style.outerHTML
    }
    return { guideOptions, styleIds }
  }

  protect(key: string): void {
    const template = document.createElement('template')
    template.innerHTML = this.source(key)
    if (template.content.querySelector('[data-olps-inquiry]')) throw new Error('该区域包含询盘表单，请在高级 HTML 中明确处理表单及引用')
    if (template.content.querySelector('[data-guide-option],[data-olps-guide-option],#olps-ads-root,[data-olps-map],[data-olps-whatsapp]')) throw new Error('该区域包含系统组件，请在高级 HTML 中处理组件及关联目标')
    const ids = Array.from(template.content.querySelectorAll('[id]')).map(element => element.id)
    const outside = document.createElement('template')
    outside.innerHTML = this.html.replace(this.source(key), '')
    if (Array.from(outside.content.querySelectorAll('[href],[aria-controls],[aria-labelledby],[aria-describedby],[for]')).some(element => ids.some(id => element.getAttribute('href') === '#' + id || ['for', 'aria-controls', 'aria-labelledby', 'aria-describedby'].some(attribute => element.getAttribute(attribute)?.split(' ').includes(id))))) throw new Error('其他区域引用了当前内容，需要选择替代目标')
  }

  remove(key: string, options?: { confirmSystem: boolean; replacementId?: string }): void {
    if (!options?.confirmSystem) { this.protect(key); this.replace(key, ''); return }
    const location = this.node(key).element.sourceCodeLocation!
    const inside = this.nodes.filter(node => {
      const childLocation = node.element.sourceCodeLocation!
      return childLocation.startOffset >= location.startOffset && childLocation.endOffset <= location.endOffset
    })
    if (inside.some(node => node.element.attrs.some(attr => attr.name === 'id' && attr.value === 'olps-ads-root'))) throw new Error('广告页面入口需要保留')
    const ids = inside.flatMap(node => node.element.attrs.filter(attr => attr.name === 'id').map(attr => attr.value))
    const outside = this.nodes.filter(node => !inside.includes(node))
    const changes = [{ start: location.startOffset, end: location.endOffset, value: '' }]
    for (const node of outside) {
      for (const attr of node.element.attrs) {
        if (!['href', 'for', 'aria-controls', 'aria-labelledby', 'aria-describedby'].includes(attr.name)) continue
        const tokens = attr.name === 'href' ? [attr.value.slice(1)] : attr.value.split(' ')
        const referenced = attr.name === 'href' ? attr.value.startsWith('#') && ids.includes(attr.value.slice(1)) : tokens.some(token => ids.includes(token))
        if (!referenced) continue
        if (!options.replacementId || !outside.some(item => item.element.attrs.some(attribute => attribute.name === 'id' && attribute.value === options.replacementId))) throw new Error('需要为其他区域的引用选择替代目标')
        const value = attr.name === 'href' ? '#' + options.replacementId : tokens.map(token => ids.includes(token) ? options.replacementId! : token).join(' ')
        const attrLocation = node.element.sourceCodeLocation!.attrs![attr.name]!
        changes.push({ start: attrLocation.startOffset, end: attrLocation.endOffset, value: `${attr.name}="${escapeText(value).replaceAll('"', '&quot;')}"` })
      }
    }
    for (const change of changes.sort((a, b) => b.start - a.start)) this.html = this.html.slice(0, change.start) + change.value + this.html.slice(change.end)
  }

  move(key: string, direction: number): void {
    const node = this.node(key)
    const siblings = this.nodes.filter(item => item.parent === node.parent)
    const target = siblings[siblings.findIndex(item => item.key === key) + direction]
    if (!target) return
    const source = this.source(key)
    const targetLocation = target.element.sourceCodeLocation!
    const location = node.element.sourceCodeLocation!
    const insertion = direction < 0 ? targetLocation.startOffset : targetLocation.endOffset
    if (insertion < location.startOffset) this.html = this.html.slice(0, insertion) + source + this.html.slice(insertion, location.startOffset) + this.html.slice(location.endOffset)
    else this.html = this.html.slice(0, location.startOffset) + this.html.slice(location.endOffset, insertion) + source + this.html.slice(insertion)
  }

  canvasHtml(assets: { url: string; previewUrl: string }[] = []): string {
    let html = this.html
    for (const node of [...this.nodes].reverse()) {
      const location = node.element.sourceCodeLocation!
      if (location.startTag) {
        const insertion = location.startTag.endOffset - (html[location.startTag.endOffset - 2] === '/' ? 2 : 1)
        html = html.slice(0, insertion) + ` data-editor-node="${node.key}"` + html.slice(insertion)
      }
    }
    const template = document.createElement('template')
    template.innerHTML = html
    template.content.querySelectorAll('script,iframe,object,embed,base,meta[http-equiv],link[rel="modulepreload"]').forEach(element => element.remove())
    template.content.querySelectorAll('*').forEach(element => {
      for (const attr of Array.from(element.attributes)) {
        if (attr.name.startsWith('on') || ['srcdoc', 'autofocus'].includes(attr.name) || attr.value.trim().toLowerCase().startsWith('javascript:')) element.removeAttribute(attr.name)
      }
    })
    rewritePreviewResources(template.content, assets)
    return template.innerHTML
  }
}

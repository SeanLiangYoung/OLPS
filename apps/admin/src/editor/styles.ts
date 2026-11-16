import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { HtmlDocument } from './document'

export type StyleScope = 'all' | 'desktop' | 'tablet' | 'mobile'
export const styleMedia: Record<Exclude<StyleScope, 'all'>, string> = {
  desktop: '(min-width: 1024px)',
  tablet: '(min-width: 600px) and (max-width: 1023px)',
  mobile: '(max-width: 599px)',
}

function styleRule(css: string): CSSStyleRule {
  const sheet = new CSSStyleSheet()
  sheet.insertRule(css, 0)
  const rule = sheet.cssRules[0]!
  return rule.type === CSSRule.MEDIA_RULE ? (rule as CSSMediaRule).cssRules[0] as CSSStyleRule : rule as CSSStyleRule
}

function existingStyle(model: HtmlDocument, id: string, scope: StyleScope) {
  return model.nodes.find(node => node.tag === 'style' && node.element.attrs.some(attr => attr.name === 'data-olps-editor-style' && attr.value === id) && node.element.attrs.some(attr => attr.name === 'data-olps-style-scope' && attr.value === scope))
}

function cssText(model: HtmlDocument, key: string): string {
  return model.node(key).element.childNodes.map(child => 'value' in child ? child.value : '').join('')
}

function appendBeforeBodyEnd(html: string, addition: string): string {
  const parsed = parse(html, { sourceCodeLocationInfo: true })
  let insertion = html.length
  const visit = (children: DefaultTreeAdapterMap['childNode'][]) => {
    for (const child of children) {
      if (!('tagName' in child)) continue
      if (child.tagName === 'body' && child.sourceCodeLocation?.endTag) insertion = child.sourceCodeLocation.endTag.startOffset
      visit(child.childNodes)
    }
  }
  visit(parsed.childNodes)
  return html.slice(0, insertion) + addition + html.slice(insertion)
}

function writeRule(html: string, id: string, scope: StyleScope, property: string, value: string): string {
  const model = new HtmlDocument(html)
  const existing = existingStyle(model, id, scope)
  const selector = `[data-olps-style="${id}"]`
  const rule = styleRule(existing ? cssText(model, existing.key) : `${selector}${scope === 'all' ? '' : selector}{}`)
  rule.style.setProperty(property, value, 'important')
  if (!value) rule.style.removeProperty(property)
  let css = rule.cssText
  if (scope !== 'all') {
    const sheet = new CSSStyleSheet()
    sheet.insertRule(`@media ${styleMedia[scope]} { ${css} }`, 0)
    css = sheet.cssRules[0]!.cssText
  }
  const tag = document.createElement('style')
  tag.setAttribute('data-olps-editor-style', id)
  tag.setAttribute('data-olps-style-scope', scope)
  tag.textContent = css
  if (existing) { model.replace(existing.key, tag.outerHTML); return model.html }
  return appendBeforeBodyEnd(html, tag.outerHTML)
}

export function setElementStyle(html: string, key: string, property: string, value: string, scope: StyleScope): { html: string; elementId: string } {
  const model = new HtmlDocument(html)
  const original = document.createElement('template')
  original.innerHTML = model.source(key)
  const element = original.content.firstElementChild as HTMLElement
  const validated = document.createElement('span').style
  validated.setProperty(property, value)
  if (value && !validated.getPropertyValue(property)) throw new Error('样式属性的值无效')
  const id = element.getAttribute('data-olps-style') || crypto.randomUUID()
  const oldValue = element.style.getPropertyValue(property)
  const attributes: Record<string, string | null> = { 'data-olps-style': id }
  if (oldValue) {
    element.style.removeProperty(property)
    attributes.style = element.getAttribute('style') || null
  }
  model.attributes(key, attributes)
  let changed = model.html
  if (scope !== 'all' && oldValue) changed = writeRule(changed, id, 'all', property, oldValue)
  changed = writeRule(changed, id, scope, property, value)
  return { html: changed, elementId: id }
}

export function elementStyleValues(html: string, key: string, scope: StyleScope): Record<string, string> {
  const model = new HtmlDocument(html)
  const element = document.createElement('template')
  element.innerHTML = model.source(key)
  const target = element.content.firstElementChild as HTMLElement
  const id = target.getAttribute('data-olps-style')
  const values: Record<string, string> = {}
  for (const property of Array.from(target.style)) values[property] = target.style.getPropertyValue(property)
  if (id) for (const candidate of scope === 'all' ? ['all'] as const : ['all', scope] as const) {
    const existing = existingStyle(model, id, candidate)
    if (!existing) continue
    const rule = styleRule(cssText(model, existing.key))
    for (const property of Array.from(rule.style)) values[property] = rule.style.getPropertyValue(property)
  }
  return values
}

export function editorMetadata(htmlDocuments: string[]): { version: 1; elementIds: string[] } {
  const ids = new Set<string>()
  for (const html of htmlDocuments) for (const node of new HtmlDocument(html).nodes) {
    const id = node.element.attrs.find(attr => attr.name === 'data-olps-style')?.value
    if (id) ids.add(id)
  }
  return { version: 1, elementIds: Array.from(ids).sort() }
}

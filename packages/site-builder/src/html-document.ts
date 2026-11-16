import * as parse5 from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import type { SeoFields } from '@olps/domain'

type Document = DefaultTreeAdapterMap['document']
type Element = DefaultTreeAdapterMap['element']
type ChildNode = DefaultTreeAdapterMap['childNode']

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

function findFirstElement(parent: Element, tagName: string): Element | null {
  for (const child of parent.childNodes) {
    if (isElement(child) && child.tagName === tagName) {
      return child
    }
  }
  return null
}

function findAllElements(parent: Element, tagName: string): Element[] {
  const found: Element[] = []
  for (const child of parent.childNodes) {
    if (isElement(child) && child.tagName === tagName) {
      found.push(child)
    }
  }
  return found
}

function removeElements(parent: Element, tagName: string, attrName?: string, attrValue?: string): void {
  parent.childNodes = parent.childNodes.filter((child) => {
    if (!isElement(child) || child.tagName !== tagName) {
      return true
    }
    if (attrName && attrValue) {
      const match = child.attrs.some((a) => a.name === attrName && a.value === attrValue)
      return !match
    }
    return false
  })
}

function setAttr(element: Element, name: string, value: string): void {
  const existing = element.attrs.find((a) => a.name === name)
  if (existing) {
    existing.value = value
  } else {
    element.attrs.push({ name, value })
  }
}

function textNode(text: string): ChildNode {
  return { nodeName: '#text', value: text, parentNode: null }
}

function element(tagName: string, attrs: { name: string; value: string }[], children: ChildNode[] = []): Element {
  const node = {
    nodeName: tagName,
    tagName,
    attrs,
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    childNodes: children,
    parentNode: null,
  } as Element
  for (const child of children) {
    child.parentNode = node
  }
  return node
}

function looksLikeFullDocument(html: string): boolean {
  const trimmed = html.trim().toLowerCase()
  return trimmed.startsWith('<!doctype') || /<html[\s>]/i.test(html)
}

function getDocumentRoot(html: string): Document {
  if (looksLikeFullDocument(html)) {
    return parse5.parse(html) as Document
  }
  const fragment = parse5.parseFragment(html) as Element
  const doc = parse5.parse('<!DOCTYPE html><html><head></head><body></body></html>') as Document
  const htmlEl = getHtmlElement(doc)
  const body = findFirstElement(htmlEl, 'body')
  if (!body) {
    throw new Error('HTML 缺少 body')
  }
  for (const child of fragment.childNodes) {
    child.parentNode = body
    body.childNodes.push(child)
  }
  return doc
}

function getHtmlElement(doc: Document): Element {
  for (const child of doc.childNodes) {
    if (isElement(child) && child.tagName === 'html') {
      return child
    }
  }
  throw new Error('HTML 缺少 html 元素')
}

function ensureHead(htmlEl: Element): Element {
  let head = findFirstElement(htmlEl, 'head')
  if (!head) {
    head = element('head', [])
    htmlEl.childNodes.unshift(head)
    head.parentNode = htmlEl
  }
  return head
}

function ensureBody(htmlEl: Element): Element {
  let body = findFirstElement(htmlEl, 'body')
  if (!body) {
    body = element('body', [])
    htmlEl.childNodes.push(body)
    body.parentNode = htmlEl
  }
  return body
}

export function applySeoToHtml(
  html: string,
  input: { locale: string; seo: SeoFields; canonicalFallback?: string; alternatives?: { locale: string; href: string }[] },
): string {
  const doc = getDocumentRoot(html)
  const htmlEl = getHtmlElement(doc)
  setAttr(htmlEl, 'lang', input.locale)

  const head = ensureHead(htmlEl)
  ensureBody(htmlEl)

  removeElements(head, 'title')
  head.childNodes.push(element('title', [], [textNode(input.seo.title)]))

  removeElements(head, 'meta', 'name', 'description')
  head.childNodes.push(
    element('meta', [
      { name: 'name', value: 'description' },
      { name: 'content', value: input.seo.description },
    ]),
  )

  const canonical = input.seo.canonical ?? input.canonicalFallback
  removeElements(head, 'link', 'rel', 'canonical')
  if (canonical) {
    head.childNodes.push(element('link', [{ name: 'rel', value: 'canonical' }, { name: 'href', value: canonical }]))
  }

  const metadata = [
    ['name', 'robots', input.seo.robots ?? 'index,follow'],
    ['property', 'og:type', 'website'],
    ['property', 'og:title', input.seo.title],
    ['property', 'og:description', input.seo.description],
    ['property', 'og:locale', input.locale.replaceAll('-', '_')],
    ['name', 'twitter:card', input.seo.image ? 'summary_large_image' : 'summary'],
    ['name', 'twitter:title', input.seo.title],
    ['name', 'twitter:description', input.seo.description],
    ...(canonical ? [['property', 'og:url', canonical]] : []),
    ...(input.seo.image ? [['property', 'og:image', input.seo.image], ['name', 'twitter:image', input.seo.image]] : []),
  ]
  for (const [attribute, name, value] of metadata) {
    removeElements(head, 'meta', attribute!, name!)
    head.childNodes.push(element('meta', [{ name: attribute!, value: name! }, { name: 'content', value: value! }]))
  }
  if (input.alternatives) {
    head.childNodes = head.childNodes.filter(child => !isElement(child) || child.tagName !== 'link' || !child.attrs.some(attr => attr.name === 'hreflang'))
    for (const alternative of input.alternatives) {
      head.childNodes.push(element('link', [{ name: 'rel', value: 'alternate' }, { name: 'hreflang', value: alternative.locale }, { name: 'href', value: alternative.href }]))
    }
  }

  if (!findAllElements(head, 'meta').some((m) => m.attrs.some((a) => a.name === 'charset'))) {
    head.childNodes.unshift(element('meta', [{ name: 'charset', value: 'utf-8' }]))
  }

  return parse5.serialize(doc)
}

export function setElementAttributeById(html: string, elementId: string, attrName: string, attrValue: string): string {
  const doc = getDocumentRoot(html)
  const htmlEl = getHtmlElement(doc)
  const body = ensureBody(htmlEl)
  let found = false
  const visit = (node: ChildNode) => {
    if (isElement(node)) {
      if (node.attrs.some((a) => a.name === 'id' && a.value === elementId)) {
        setAttr(node, attrName, attrValue)
        found = true
      }
      for (const child of node.childNodes) {
        visit(child)
      }
    }
  }
  visit(body)
  if (!found) {
    throw new Error(`HTML 缺少元素 id=${elementId}`)
  }
  return parse5.serialize(doc)
}

export function injectBeforeBodyClose(html: string, injection: string): string {
  const doc = getDocumentRoot(html)
  const htmlEl = getHtmlElement(doc)
  const body = ensureBody(htmlEl)
  const fragment = parse5.parseFragment(injection) as Element
  for (const child of fragment.childNodes) {
    child.parentNode = body
    body.childNodes.push(child)
  }
  return parse5.serialize(doc)
}

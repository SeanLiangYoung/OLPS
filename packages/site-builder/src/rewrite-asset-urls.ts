import * as parse5 from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

type Element = DefaultTreeAdapterMap['element']
type ChildNode = DefaultTreeAdapterMap['childNode']

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

function walkChildren(nodes: ChildNode[], visit: (el: Element) => void): void {
  for (const node of nodes) {
    if (!isElement(node)) {
      continue
    }
    visit(node)
    walkChildren(node.childNodes as ChildNode[], visit)
  }
}

function isExternalUrl(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url) || url.startsWith('//')
}

function isSiteAssetPath(url: string): boolean {
  if (!url || url.startsWith('#') || url.startsWith('data:') || url.startsWith('mailto:') || url.startsWith('tel:')) {
    return false
  }
  if (isExternalUrl(url)) {
    return false
  }
  const trimmed = url.trim()
  if (trimmed.startsWith('/assets/')) {
    return true
  }
  if (trimmed.startsWith('assets/')) {
    return true
  }
  return false
}

function rewriteAssetUrl(url: string, sitePrefix: string): string {
  const trimmed = url.trim()
  if (trimmed.startsWith('/assets/')) {
    return `${sitePrefix}${trimmed}`
  }
  if (trimmed.startsWith('assets/')) {
    return `${sitePrefix}/${trimmed}`
  }
  return url
}

function rewriteSrcset(value: string, sitePrefix: string): string {
  return value
    .split(',')
    .map((part) => {
      const chunk = part.trim()
      if (!chunk) {
        return chunk
      }
      const pieces = chunk.split(/\s+/)
      const url = pieces[0] ?? ''
      if (!isSiteAssetPath(url)) {
        return chunk
      }
      pieces[0] = rewriteAssetUrl(url, sitePrefix)
      return pieces.join(' ')
    })
    .join(', ')
}

function rewriteStyleUrls(value: string, sitePrefix: string): string {
  return value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote, inner) => {
    const raw = String(inner).trim()
    if (!isSiteAssetPath(raw)) {
      return full
    }
    return `url(${quote}${rewriteAssetUrl(raw, sitePrefix)}${quote})`
  })
}

function setAttr(el: Element, name: string, value: string): void {
  const existing = el.attrs.find((a) => a.name === name)
  if (existing) {
    existing.value = value
  } else {
    el.attrs.push({ name, value })
  }
}

export function rewriteSiteAssetReferences(html: string, sitePrefix: string): string {
  if (!sitePrefix) {
    return html
  }
  const doc = parse5.parse(html) as DefaultTreeAdapterMap['document']
  walkChildren(doc.childNodes, (el) => {
    const tag = el.tagName
    for (const attr of [...el.attrs]) {
      if (['src', 'href'].includes(attr.name) && isSiteAssetPath(attr.value)) {
        setAttr(el, attr.name, rewriteAssetUrl(attr.value, sitePrefix))
      }
      if (attr.name === 'srcset' && isSiteAssetPath(attr.value.split(/\s+/)[0] ?? '')) {
        setAttr(el, attr.name, rewriteSrcset(attr.value, sitePrefix))
      } else if (attr.name === 'srcset') {
        setAttr(el, attr.name, rewriteSrcset(attr.value, sitePrefix))
      }
      if (attr.name === 'style') {
        setAttr(el, attr.name, rewriteStyleUrls(attr.value, sitePrefix))
      }
    }
    if (tag === 'style') {
      for (const child of el.childNodes) {
        if (child.nodeName === '#text' && 'value' in child) {
          child.value = rewriteStyleUrls(String(child.value), sitePrefix)
        }
      }
    }
  })
  return parse5.serialize(doc)
}

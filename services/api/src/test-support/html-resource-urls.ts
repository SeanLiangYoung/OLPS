import * as parse5 from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

type Element = DefaultTreeAdapterMap['element']
type ChildNode = DefaultTreeAdapterMap['childNode']

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

function attrValue(el: Element, name: string): string | null {
  const found = el.attrs.find((a) => a.name === name)
  return found?.value ?? null
}

function walkElements(nodes: ChildNode[], visit: (el: Element) => void): void {
  for (const node of nodes) {
    if (!isElement(node)) {
      continue
    }
    visit(node)
    walkElements(node.childNodes as ChildNode[], visit)
  }
}

export function extractStylesheetHrefs(html: string): string[] {
  const doc = parse5.parse(html)
  const hrefs: string[] = []
  walkElements(doc.childNodes as ChildNode[], (el) => {
    if (el.tagName === 'link' && attrValue(el, 'rel') === 'stylesheet') {
      const href = attrValue(el, 'href')
      if (href) {
        hrefs.push(href)
      }
    }
  })
  return hrefs
}

export function extractImageSrcs(html: string): string[] {
  const doc = parse5.parse(html)
  const srcs: string[] = []
  walkElements(doc.childNodes as ChildNode[], (el) => {
    if (el.tagName === 'img') {
      const src = attrValue(el, 'src')
      if (src) {
        srcs.push(src)
      }
    }
  })
  return srcs
}

export function extractCanonicalHref(html: string): string | null {
  const doc = parse5.parse(html)
  let canonical: string | null = null
  walkElements(doc.childNodes as ChildNode[], (el) => {
    if (el.tagName === 'link' && attrValue(el, 'rel') === 'canonical') {
      canonical = attrValue(el, 'href')
    }
  })
  return canonical
}

export function resolvePreviewPath(previewPagePath: string, resourceHref: string): string {
  const base = previewPagePath.endsWith('/') ? previewPagePath : `${previewPagePath}/`
  return new URL(resourceHref, `http://127.0.0.1${base}`).pathname
}

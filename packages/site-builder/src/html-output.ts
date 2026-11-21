import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5'

export type HtmlNode = DefaultTreeAdapterMap['node']
export type HtmlElement = DefaultTreeAdapterMap['element']

export function walkHtml(node: HtmlNode, visit: (element: HtmlElement) => void): void {
  if ('tagName' in node) visit(node)
  if ('childNodes' in node) for (const child of node.childNodes) walkHtml(child, visit)
}

export function bodyHtml(html: string): string {
  const document = parse(html)
  let body: HtmlElement | undefined
  let main: HtmlElement | undefined
  walkHtml(document, element => {
    if (element.tagName === 'body') body = element
    if (element.tagName === 'main') main = element
  })
  if (!body) throw new Error('HTML 缺少 body')
  return serialize(main ?? body)
}

export function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function siteAbsoluteUrl(siteUrl: string, relative: string): string {
  return new URL(relative.replace(/^\//, ''), `${siteUrl.replace(/\/$/, '')}/`).href
}

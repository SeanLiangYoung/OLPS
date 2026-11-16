import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5'
import { sitePagePath } from './publish-urls.js'
import { slugifyKeyword } from './slugify-keyword.js'
import type { PublishConfig, StoredPageJson } from './types.js'

export function rewritePageLinks(html: string, config: PublishConfig, pages: StoredPageJson[]): string {
  if (!html.includes('data-olps-page-link')) return html
  const document = parse(html)
  function visit(node: DefaultTreeAdapterMap['node']) {
    if ('attrs' in node) {
      const reference = node.attrs.find(attribute => attribute.name === 'data-olps-page-link')
      if (reference) {
        const target = pages.find(page => page.pageId === reference.value && page.status !== 'unpublished')
        if (!target) throw new Error(`关联页面不存在：${reference.value}`)
        const keyword = target.kind === 'ads' ? target.body.ads?.keywordCluster[0] : undefined
        const route = keyword ? `${target.slug}--${slugifyKeyword(keyword)}` : target.slug
        const href = sitePagePath(config, route)
        const attribute = node.attrs.find(item => item.name === 'href')
        if (attribute) attribute.value = href
        else node.attrs.push({ name: 'href', value: href })
      }
      if (node.tagName === 'template') for (const child of (node as DefaultTreeAdapterMap['template']).content.childNodes) visit(child)
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child)
  }
  visit(document)
  return serialize(document)
}

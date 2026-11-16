import type { PageRecord } from '@olps/domain'
import type { GenerateOutput } from './generate.js'
import { parse, type DefaultTreeAdapterMap } from 'parse5'

type PageContent = { body: { html: string; ads?: { screens: Array<{ html: string }> } } }
export function assertRewriteComponentsPreserved(source: PageContent, generated: PageContent): void {
  function counts(page: PageContent) {
    const result = new Map<string, number>()
    function visit(node: DefaultTreeAdapterMap['node']) {
      if ('attrs' in node) {
        for (const attribute of node.attrs) {
          const key = ['data-olps-inquiry', 'data-olps-map', 'data-olps-whatsapp'].includes(attribute.name) ? attribute.name : attribute.name === 'id' && attribute.value === 'olps-ads-root' ? 'olps-ads-root' : null
          if (key) result.set(key, (result.get(key) || 0) + 1)
        }
      }
      if ('childNodes' in node) for (const child of node.childNodes) visit(child)
    }
    for (const html of [page.body.html, ...(page.body.ads?.screens.map(screen => screen.html) || [])]) visit(parse(html))
    return result
  }
  const before = counts(source)
  const after = counts(generated)
  for (const [component, count] of before) if ((after.get(component) || 0) < count) throw new Error(`改写结果需要保留已有业务组件：${component}`)
}

export function createRewriteProposal(source: PageRecord, generated: GenerateOutput, generation: Record<string, unknown>): PageRecord {
  assertRewriteComponentsPreserved(source, generated)
  return {
    ...source, ...generated, pageId: source.pageId, locale: source.locale,
    translationGroupId: source.translationGroupId,
    seo: { ...source.seo, ...generated.seo, robots: source.seo.robots },
    metadata: { ...source.metadata, generation },
  }
}

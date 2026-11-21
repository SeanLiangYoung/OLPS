import { parse, parseFragment, serialize } from 'parse5'
import { absoluteUrlForPage, relativeUrl, type SiteModel } from '@olps/render'
import type { PublicHtmlRoute } from './public-html-routes.js'
import { escapeAttribute, walkHtml } from './html-output.js'

export function addRuntimeMetadata(html: string, model: SiteModel, route: PublicHtmlRoute, mode: 'publish' | 'preview'): string {
  const document = parse(html)
  const target = route.target.kind === 'page' ? { ref: 'page', id: route.target.pageId }
    : route.target.kind === 'collection' ? { ref: 'collection', id: route.target.collectionId }
    : route.target.kind === 'group' ? { ref: 'group', id: route.target.groupId } : { ref: 'item', id: route.target.itemId }
  const roleUrl = (role: string): string => {
    const page = model.pages.find(entry => entry.meta.role === role)
    const url = page && absoluteUrlForPage(page, route.locale)
    if (!url) throw new Error(`缺少页面职责地址：${role}`)
    return relativeUrl(route.url, url)
  }
  walkHtml(document, element => {
    if (mode === 'publish' && element.tagName === 'head' && model.publishConfig.connectors.searchConsole?.verificationMeta) {
      const meta = parseFragment(`<meta name="google-site-verification" content="${escapeAttribute(model.publishConfig.connectors.searchConsole.verificationMeta)}">`).childNodes[0]
      if ('parentNode' in meta) meta.parentNode = element
      element.childNodes.push(meta)
    }
    if (element.tagName === 'html') element.attrs.push({ name: 'data-olps-site-id', value: model.publishConfig.siteId })
    if (element.tagName === 'form' && element.attrs.some(attribute => attribute.name === 'data-olps-inquiry-form')) {
      element.attrs.push({ name: 'data-olps-target', value: JSON.stringify(target) })
      element.attrs.push({ name: 'data-olps-thank-you-url', value: roleUrl('thank-you') })
      element.attrs.push({ name: 'data-olps-source', value: mode === 'preview' ? 'preview' : 'public' })
      if (mode === 'publish') element.attrs.push({ name: 'data-olps-inquiry-endpoint', value: `${model.publishConfig.publicApiBaseUrl.replace(/\/$/, '')}/api/public/${encodeURIComponent(model.publishConfig.siteId)}/inquiries` })
    }
    if (mode === 'publish' && element.tagName === 'body') {
      const config = JSON.stringify({
        connectors: model.publishConfig.connectors,
        locale: route.locale,
        cookiePolicyUrl: roleUrl('cookies'),
        eventCollector:{endpoint:`${model.publishConfig.publicApiBaseUrl.replace(/\/$/,'')}/api/public/${encodeURIComponent(model.publishConfig.siteId)}/events`,target},
      }).replaceAll('<', '\\u003c')
      const scripts = parseFragment(`<script id="olps-tracking-config" type="application/json">${config}</script><script src="${relativeUrl(route.url, '/olps-tracking.js')}" defer></script>`).childNodes
      for (const script of scripts) if ('parentNode' in script) script.parentNode = element
      element.childNodes.push(...scripts)
    }
  })
  return serialize(document)
}

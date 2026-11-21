import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'
import { parseSrcset, stringifySrcset } from 'srcset'
import * as cssTree from 'css-tree'
import { relativeUrl, renderTarget, type SiteModel, type SourceReader } from '@olps/render'
import { escapeAttribute, siteAbsoluteUrl, walkHtml } from './html-output.js'
import type { OutputFile } from './types.js'

export async function planNotFound(model: SiteModel, reader: SourceReader, mode: 'publish' | 'preview' = 'publish'): Promise<OutputFile[]> {
  const page = model.pages.find(candidate => candidate.meta.role === 'not-found')
  if (!page) throw new Error('缺少 404 页面')
  const files: OutputFile[] = []
  for (const locale of model.settings.locales) {
    const html = await renderTarget(model, { kind: 'page', pageId: page.meta.pageId }, locale.code, { mode, reader })
    const pagePath = `/${locale.code}/404.html`
    const document = parse(html)
    const rootDocument = parse(html)
    function rewrite(document: DefaultTreeAdapterMap['document'], rootCopy: boolean): void {
      function url(value: string): string {
        if (!value || value.startsWith('#') || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return value
        const resolved = new URL(value, `https://404.invalid${pagePath}`)
        return mode === 'publish' ? siteAbsoluteUrl(model.settings.siteUrl, `${resolved.pathname}${resolved.search}${resolved.hash}`) : `${relativeUrl(rootCopy ? '/404.html' : pagePath, resolved.pathname)}${resolved.search}${resolved.hash}`
      }
      function rewriteCss(value: string, context: 'stylesheet' | 'declarationList'): string {
        const ast = cssTree.parse(value, { context })
        cssTree.walk(ast, node => {
          if (node.type === 'Url') node.value = url(node.value)
        })
        return cssTree.generate(ast)
      }
      walkHtml(document, element => {
      for (const attribute of element.attrs) {
        if (['href', 'src', 'action', 'poster'].includes(attribute.name)) attribute.value = url(attribute.value)
        if (attribute.name === 'srcset') {
          attribute.value = stringifySrcset(parseSrcset(attribute.value).map(entry => ({ ...entry, url: url(entry.url) })))
        }
        if (attribute.name === 'style') attribute.value = rewriteCss(attribute.value, 'declarationList')
      }
      if (element.tagName === 'style') {
        for (const child of element.childNodes) {
          if ('value' in child && child.nodeName === '#text') child.value = rewriteCss(child.value, 'stylesheet')
        }
      }
      if (element.tagName === 'head' && mode === 'publish') {
        const base = parseFragment(`<base href="${escapeAttribute(model.settings.siteUrl.replace(/\/$/, ''))}/">`).childNodes[0]
        if ('parentNode' in base) base.parentNode = element
        element.childNodes.unshift(base)
      }
      })
    }
    rewrite(document, false)
    const content = serialize(document)
    files.push({ relativePath: `${locale.code}/404.html`, content })
    if (locale.code === model.settings.defaultLocale) {
      rewrite(rootDocument, true)
      files.push({ relativePath: '404.html', content: serialize(rootDocument) })
    }
  }
  return files
}

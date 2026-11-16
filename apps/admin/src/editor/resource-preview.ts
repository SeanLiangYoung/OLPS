import { parse, walk, generate } from 'css-tree'
import { parseSrcset, stringifySrcset } from 'srcset'

export type PreviewResource = { url: string; previewUrl: string }

function resourceUrl(url: string, resources: PreviewResource[]): string {
  if (!url || url.startsWith('#')) return url
  const resolved = new URL(url, 'https://editor.local/')
  if (resolved.origin !== 'https://editor.local') return url
  const resource = resources.find(resource => resource.url === resolved.pathname)
  return resource ? resource.previewUrl + resolved.hash : url
}

function rewriteCss(css: string, resources: PreviewResource[], context: 'stylesheet' | 'declarationList'): string {
  const ast = parse(css, { context, parseCustomProperty: true })
  let changed = false
  walk(ast, node => {
    if (node.type === 'Atrule' && node.name.toLowerCase() === 'import' && node.prelude?.type === 'AtrulePrelude') {
      const target = node.prelude.children.first
      if (target?.type === 'String') {
        const replacement = resourceUrl(target.value, resources)
        if (replacement !== target.value) { target.value = replacement; changed = true }
      }
    }
    if (node.type !== 'Url') return
    const replacement = resourceUrl(node.value, resources)
    if (replacement !== node.value) { node.value = replacement; changed = true }
  })
  return changed ? generate(ast) : css
}

export function rewritePreviewResources(fragment: ParentNode, resources: PreviewResource[]): void {
  if (!resources.length) return
  fragment.querySelectorAll('*').forEach(element => {
    for (const attribute of ['src', 'poster']) {
      const value = element.getAttribute(attribute)
      if (value) element.setAttribute(attribute, resourceUrl(value, resources))
    }
    if (element.tagName === 'LINK') {
      const value = element.getAttribute('href')
      if (value) element.setAttribute('href', resourceUrl(value, resources))
    }
    const srcset = element.getAttribute('srcset')
    if (srcset) element.setAttribute('srcset', stringifySrcset(parseSrcset(srcset, { strict: true }).map(source => ({ ...source, url: resourceUrl(source.url, resources) })), { strict: true }))
    const inlineStyle = element.getAttribute('style')
    if (inlineStyle) element.setAttribute('style', rewriteCss(inlineStyle, resources, 'declarationList'))
    if (element.tagName === 'STYLE') element.textContent = rewriteCss(element.textContent || '', resources, 'stylesheet')
  })
}

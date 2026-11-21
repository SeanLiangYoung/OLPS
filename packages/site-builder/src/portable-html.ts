import path from 'node:path'
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5'
import * as cssTree from 'css-tree'
import { parseSrcset, stringifySrcset } from 'srcset'

function portableUrl(value: string, relativePath: string): string {
    if (!value.startsWith('/') || value.startsWith('//')) return value
    const url = new URL(value, 'https://site.invalid')
    const relative = path.posix.relative(path.posix.dirname(relativePath), url.pathname.slice(1)) || '.'
    return `${relative}${url.pathname.endsWith('/') ? '/' : ''}${url.search}${url.hash}`
}

export function makeCssPortable(source: string, relativePath: string): string {
  const ast = cssTree.parse(source)
  const relative = relativePath.replace(/^public\//, '')
  cssTree.walk(ast, node => {
    if (node.type === 'Url') node.value = portableUrl(node.value, relative)
  })
  return cssTree.generate(ast)
}

export function makeHtmlPortable(html: string, relativePath: string): string {
  const relativeUrl = (value: string) => portableUrl(value, relativePath)
  function rewriteCss(value: string, context: 'declarationList' | 'stylesheet'): string {
    const ast = cssTree.parse(value, { context })
    cssTree.walk(ast, node => {
      if (node.type === 'Url') node.value = relativeUrl(node.value)
    })
    return cssTree.generate(ast)
  }
  const document = parse(html)
  function visit(node: DefaultTreeAdapterMap['node']): void {
    if ('attrs' in node) {
      const rel = node.attrs.find(attr => attr.name === 'rel')?.value ?? ''
      for (const attribute of node.attrs) {
        if (['href', 'src', 'poster', 'action', 'data'].includes(attribute.name)) {
          if (node.tagName === 'link' && /\b(canonical|alternate)\b/.test(rel)) continue
          attribute.value = relativeUrl(attribute.value)
        }
        if (attribute.name === 'srcset') {
          attribute.value = stringifySrcset(parseSrcset(attribute.value).map(entry => ({ ...entry, url: relativeUrl(entry.url) })))
        }
        if (attribute.name === 'style') attribute.value = rewriteCss(attribute.value, 'declarationList')
      }
      if (node.tagName === 'style') {
        for (const child of node.childNodes) {
          if ('value' in child && child.nodeName === '#text') child.value = rewriteCss(child.value, 'stylesheet')
        }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child)
  }
  visit(document)
  return serialize(document)
}

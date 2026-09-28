import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parse as parseTemplate,
  NodeTypes,
  type ElementNode,
  type RootNode,
  type TemplateChildNode,
} from '@vue/compiler-dom'
import { parse as parseSfc } from '@vue/compiler-sfc'

export function readPageDetailVueSource(): string {
  return readFileSync(join(import.meta.dirname, '../pages/PageDetailPage.vue'), 'utf8')
}

function previewIframeElementFromSfc(source: string): ElementNode | null {
  const { descriptor, errors } = parseSfc(source, { filename: 'PageDetailPage.vue' })
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('\n'))
  }
  const templateSource = descriptor.template?.content
  if (!templateSource) return null
  const ast = parseTemplate(templateSource)
  return findPreviewIframe(ast)
}

function findPreviewIframe(node: RootNode | TemplateChildNode): ElementNode | null {
  if (node.type === NodeTypes.ROOT) {
    for (const child of node.children) {
      const found = findPreviewIframe(child)
      if (found) return found
    }
    return null
  }
  if (node.type === NodeTypes.ELEMENT) {
    if (node.tag === 'iframe' && elementHasStaticTitle(node, 'page-preview')) {
      return node
    }
    for (const child of node.children) {
      const found = findPreviewIframe(child)
      if (found) return found
    }
    return null
  }
  if (node.type === NodeTypes.IF) {
    for (const branch of node.branches) {
      for (const child of branch.children) {
        const found = findPreviewIframe(child)
        if (found) return found
      }
    }
    return null
  }
  if (node.type === NodeTypes.FOR) {
    for (const child of node.children) {
      const found = findPreviewIframe(child)
      if (found) return found
    }
    return null
  }
  if (node.type === NodeTypes.IF_BRANCH) {
    for (const child of node.children) {
      const found = findPreviewIframe(child)
      if (found) return found
    }
    return null
  }
  return null
}

function attributeStaticContent(prop: ElementNode['props'][number]): string | null {
  if (prop.type !== NodeTypes.ATTRIBUTE) return null
  const raw = prop.value
  if (raw === undefined || raw === null) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object' && 'content' in raw && typeof raw.content === 'string') {
    return raw.content
  }
  return null
}

function elementHasStaticTitle(el: ElementNode, title: string): boolean {
  for (const prop of el.props) {
    if (prop.name === 'title' && attributeStaticContent(prop) === title) {
      return true
    }
  }
  return false
}

function staticSandboxAttribute(el: ElementNode): string | null {
  for (const prop of el.props) {
    if (prop.name === 'sandbox') {
      return attributeStaticContent(prop)
    }
  }
  return null
}

export function requirePreviewIframe(source: string): ElementNode {
  const iframe = previewIframeElementFromSfc(source)
  if (!iframe) {
    throw new Error('PageDetailPage 模板中未找到 title="page-preview" 的 iframe')
  }
  return iframe
}

export function previewIframeSandboxTokens(source: string): string[] {
  const iframe = requirePreviewIframe(source)
  const raw = staticSandboxAttribute(iframe)
  if (raw === null) {
    throw new Error('预览 iframe 缺少 sandbox 属性')
  }
  return raw.split(/\s+/).filter(Boolean)
}

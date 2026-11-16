import { HtmlDocument } from './editor/document'

function regions(html: string) {
  const document = new HtmlDocument(html)
  return document.nodes.filter(node => !node.parent && !['style', 'script', 'meta', 'link'].includes(node.tag)).map((node, index) => {
    const id = node.element.attrs.find(attribute => attribute.name === 'id')?.value
    const template = window.document.createElement('template')
    template.innerHTML = document.source(node.key)
    return { key: id || `region-${index}`, nodeKey: node.key, tag: node.tag, html: document.source(node.key), label: template.content.textContent?.trim().slice(0, 160) || `内容区域 ${index + 1}` }
  })
}

export function listProposalRegions(original: string, proposed: string) {
  const originalDocument = new HtmlDocument(original)
  const proposedDocument = new HtmlDocument(proposed)
  const originalDependencies = new Set(originalDocument.nodes.filter(node => ['style', 'link', 'script'].includes(node.tag)).map(node => originalDocument.source(node.key)))
  if (proposedDocument.nodes.filter(node => ['style', 'link', 'script'].includes(node.tag)).some(node => !originalDependencies.has(proposedDocument.source(node.key)))) return []
  const current = regions(original)
  const next = regions(proposed)
  if (current.length !== next.length || current.some((region, index) => region.key !== next[index]!.key || region.tag !== next[index]!.tag)) return []
  return current.flatMap((region, index) => region.html === next[index]!.html ? [] : [{ key: region.key, before: region.label, after: next[index]!.label }])
}

export function mergeProposalRegions(original: string, proposed: string, keys: string[]): string {
  const allowed = listProposalRegions(original, proposed)
  if (keys.some(key => !allowed.some(region => region.key === key))) throw new Error('区域结构已经变化，请选择整体采用或继续编辑')
  const current = regions(original)
  const next = regions(proposed)
  const document = new HtmlDocument(original)
  for (const region of [...current].reverse()) {
    if (keys.includes(region.key)) document.replace(region.nodeKey, next.find(item => item.key === region.key)!.html)
  }
  const originalContent = window.document.createElement('template')
  const mergedContent = window.document.createElement('template')
  originalContent.innerHTML = original
  mergedContent.innerHTML = document.html
  for (const selector of ['[data-olps-inquiry]', '[data-olps-map]', '[data-olps-whatsapp]', '#olps-ads-root']) {
    if (mergedContent.content.querySelectorAll(selector).length < originalContent.content.querySelectorAll(selector).length) throw new Error('所选区域需要保留已有业务组件，请整体审阅')
  }
  return document.html
}

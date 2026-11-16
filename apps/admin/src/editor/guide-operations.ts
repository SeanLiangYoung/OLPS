import type { AdsPayload } from '../types'
import { HtmlDocument } from './document'

export function duplicateRegion(html: string, key: string, ads?: AdsPayload, screenId?: string): { html: string; ads?: AdsPayload } {
  const model = new HtmlDocument(html)
  const template = document.createElement('template')
  template.innerHTML = model.source(key)
  const optionIds = new Set(Array.from(template.content.querySelectorAll('[data-guide-option],[data-olps-guide-option]')).flatMap(element => ['data-guide-option', 'data-olps-guide-option'].map(attribute => element.getAttribute(attribute)).filter((id): id is string => !!id)))
  const options = ads?.guide.nodes[screenId || '']?.options
  for (const id of optionIds) if (!options?.some(option => option.id === id)) throw new Error(`Guide 按钮 ${id} 缺少当前屏中的对应选项`)
  const result = model.duplicate(key)
  const updated = ads ? JSON.parse(JSON.stringify(ads)) as AdsPayload : undefined
  if (updated) {
    const node = updated.guide.nodes[screenId || '']
    for (const [id, duplicatedId] of Object.entries(result.guideOptions)) node!.options.push({ ...options!.find(option => option.id === id)!, id: duplicatedId })
  }
  return { html: model.html, ads: updated }
}

export function updateGuideLabel(html: string, ads: AdsPayload, screenId: string, optionId: string, label: string): { html: string; ads: AdsPayload } {
  const updated = JSON.parse(JSON.stringify(ads)) as AdsPayload
  const option = updated.guide.nodes[screenId]?.options.find(item => item.id === optionId)
  if (!option) throw new Error(`Guide 按钮 ${optionId} 缺少对应选项`)
  option.label = label
  const model = new HtmlDocument(html)
  const matched = model.nodes.filter(node => node.element.attrs.some(attribute => ['data-guide-option', 'data-olps-guide-option'].includes(attribute.name) && attribute.value === optionId))
  const outermost = matched.filter(node => !matched.some(ancestor => ancestor !== node && ancestor.element.sourceCodeLocation!.startOffset < node.element.sourceCodeLocation!.startOffset && ancestor.element.sourceCodeLocation!.endOffset > node.element.sourceCodeLocation!.endOffset))
  for (const node of [...outermost].reverse()) {
    const template = document.createElement('template')
    template.innerHTML = model.source(node.key)
    const button = template.content.firstElementChild!
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
    let current = walker.nextNode()
    let written = false
    while (current) {
      if (!current.parentElement?.closest('script,style')) { current.textContent = written ? '' : label; written = true }
      current = walker.nextNode()
    }
    if (!written) button.append(document.createTextNode(label))
    model.replace(node.key, template.innerHTML)
  }
  return { html: model.html, ads: updated }
}

export function removeRegion(html: string, key: string, ads?: AdsPayload, screenId?: string, options?: { confirmSystem: boolean; replacementId?: string }): { html: string; ads?: AdsPayload } {
  const model = new HtmlDocument(html)
  const template = document.createElement('template')
  template.innerHTML = model.source(key)
  const removedIds = new Set(Array.from(template.content.querySelectorAll('[data-guide-option],[data-olps-guide-option]')).flatMap(element => ['data-guide-option', 'data-olps-guide-option'].map(attribute => element.getAttribute(attribute)).filter((id): id is string => !!id)))
  model.remove(key, options)
  const updated = ads ? JSON.parse(JSON.stringify(ads)) as AdsPayload : undefined
  const node = updated?.guide.nodes[screenId || '']
  if (node) {
    const remainingIds = new Set(new HtmlDocument(model.html).nodes.flatMap(element => element.element.attrs.filter(attribute => ['data-guide-option', 'data-olps-guide-option'].includes(attribute.name)).map(attribute => attribute.value)))
    node.options = node.options.filter(option => !removedIds.has(option.id) || remainingIds.has(option.id))
  }
  return { html: model.html, ads: updated }
}

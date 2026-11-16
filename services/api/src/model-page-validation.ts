import { z } from 'zod'
import * as parse5 from 'parse5'
import { validateGuideGraph, type PageKind } from '@olps/domain'
import type { GenerateOutput } from './generate.js'

function elementsOf(node: parse5.DefaultTreeAdapterMap['node']): parse5.DefaultTreeAdapterMap['element'][] {
  const result: parse5.DefaultTreeAdapterMap['element'][] = []
  if ('tagName' in node) result.push(node)
  if ('childNodes' in node) for (const child of node.childNodes) result.push(...elementsOf(child))
  return result
}

const optionSchema = z.object({ id: z.string().min(1), label: z.string().min(1), action: z.enum(['navigate', 'go_cta', 'link_page']), targetScreenId: z.string().optional(), pageId: z.string().optional() })
export const generatedPageSchema = z.object({
  title: z.string().trim().min(1),
  seo: z.object({ title: z.string().trim().min(1), description: z.string().trim().min(1), image: z.string().optional() }),
  body: z.object({
    html: z.string().min(1),
    ads: z.object({
      keywordCluster: z.array(z.string().min(1)).min(2),
      screens: z.array(z.object({ screenId: z.string().min(1), role: z.enum(['entry', 'content', 'cta']), title: z.string().min(1), html: z.string(), entryFor: z.array(z.string()).optional() })),
      guide: z.object({ entryByKeyword: z.record(z.string(), z.string()), nodes: z.record(z.string(), z.object({ options: z.array(optionSchema) })) }),
    }).optional(),
  }),
})

export function validateGeneratedPage(value: unknown, input: { kind: PageKind; title: string; slug: string; locale: string; screenCap?: number }): GenerateOutput {
  const page = generatedPageSchema.parse(value)
  const document = parse5.parse(page.body.html)
  const tags = new Set<string>()
  let text = ''
  function visit(node: parse5.DefaultTreeAdapterMap['node']): void {
    if ('tagName' in node) {
      tags.add(node.tagName)
      if (['script', 'style'].includes(node.tagName)) return
    }
    if ('value' in node && node.nodeName === '#text') text += node.value
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(document)
  if (input.kind === 'ads') {
    if (!page.body.ads) throw new Error('模型未返回广告屏幕和 Guide')
    if (!elementsOf(document).some(element => element.attrs.some(attr => attr.name === 'id' && attr.value === 'olps-ads-root'))) throw new Error('广告正文缺少 olps-ads-root 根元素')
    const result = validateGuideGraph(page.body.ads, { screenCap: input.screenCap ?? 20 })
    if (!result.ok) throw new Error(result.issues.map(issue => issue.message).join('；'))
    const cta = page.body.ads.screens.find(screen => screen.role === 'cta')!
    const form = elementsOf(parse5.parseFragment(cta.html)).find(element => element.tagName === 'form' && element.attrs.some(attr => attr.name === 'data-olps-inquiry'))
    const names = new Set(form ? elementsOf(form).filter(element => ['input','textarea'].includes(element.tagName)).map(element => element.attrs.find(attr => attr.name === 'name')?.value) : [])
    if (!form || ['name','email','message'].some(name => !names.has(name))) throw new Error('广告转化屏需要包含 name、email、message 的询盘表单')
  } else {
    if (page.body.ads) throw new Error('普通页面不能包含广告 Guide')
    if (!tags.has('h1') || (!tags.has('main') && !tags.has('article')) || text.trim().length < 120) {
      throw new Error('模型返回的页面正文不完整，需要主标题、主要内容及完整介绍')
    }
  }
  return { ...page, slug: input.slug, locale: input.locale }
}

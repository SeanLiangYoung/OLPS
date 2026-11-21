import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { parse } from 'acorn'
import { simple } from 'acorn-walk'

export function googleConversionTag(snippet: string): { conversionId: string; conversionLabel: string } {
  const scripts: string[] = []
  function walk(node: DefaultTreeAdapterMap['node']): void {
    if ('tagName' in node && node.tagName === 'script') scripts.push(node.childNodes.filter(child => child.nodeName === '#text').map(child => 'value' in child ? child.value : '').join(''))
    if ('childNodes' in node) for (const child of node.childNodes) walk(child)
  }
  walk(parseFragment(snippet))
  let result: { conversionId: string; conversionLabel: string } | undefined
  for (const script of scripts) {
    simple(parse(script, { ecmaVersion: 'latest' }), {
      Property(node) {
        if ((node.key.type === 'Identifier' && node.key.name === 'send_to' || node.key.type === 'Literal' && node.key.value === 'send_to') && node.value.type === 'Literal' && typeof node.value.value === 'string') {
          const match = /^(AW-\d+)\/([A-Za-z0-9_-]+)$/.exec(node.value.value)
          if (match) result = { conversionId: match[1], conversionLabel: match[2] }
        }
      },
    })
  }
  if (!result) throw new Error('Google Ads未返回可用的转化标签')
  return result
}

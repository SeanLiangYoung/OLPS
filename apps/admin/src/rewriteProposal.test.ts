import { describe, expect, it } from 'vitest'
import { listProposalRegions, mergeProposalRegions } from './rewriteProposal'

describe('按内容区域采用改写结果', () => {
  const original = '<!--保留--><section id="intro"><h2>原介绍</h2></section><section id="case"><p>原案例</p></section><script>window.keep=true</script>'
  const proposed = '<section id="intro"><h2>新介绍</h2></section><section id="case"><p>新案例</p></section>'
  it('只修改选中的区域并保留其他内容及脚本', () => {
    const regions = listProposalRegions(original, proposed)
    expect(regions).toHaveLength(2)
    expect(mergeProposalRegions(original, proposed, [regions[0]!.key])).toBe(original.replace('<h2>原介绍</h2>', '<h2>新介绍</h2>'))
  })
  it('无法对应的结构不能通过部分采用覆盖原内容', () => {
    expect(() => mergeProposalRegions(original, '<main>新结构</main>', ['intro'])).toThrow('区域结构已经变化')
  })
  it('新增全局样式依赖时明确阻止部分采用', () => {
    const before = '<style>.old{color:red}</style><section id="intro" class="old">当前内容</section>'
    const after = '<style>.new{color:blue}</style><section id="intro" class="new">建议内容</section>'
    expect(listProposalRegions(before, after)).toEqual([])
    expect(() => mergeProposalRegions(before, after, ['intro'])).toThrow('区域结构已经变化')
  })
  it('部分采用不能删除被候选移动到另一区域的业务组件', () => {
    const before = '<section id="a"><form data-olps-inquiry></form></section><section id="b"><p>介绍</p></section>'
    const after = '<section id="a"><p>新介绍</p></section><section id="b"><form data-olps-inquiry></form></section>'
    expect(() => mergeProposalRegions(before, after, ['a'])).toThrow('已有业务组件')
  })
})

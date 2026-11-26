import { describe, expect, it } from 'vitest'
import { renderKnowledgeDocumentMarkdown } from './renderKnowledgeDocumentMarkdown'

describe('renderKnowledgeDocumentMarkdown', () => {
  it('把 markdown 链接渲染成纯文字，不生成 a 标签', () => {
    const html = renderKnowledgeDocumentMarkdown(
      '## 产品条目\n\n- [MLC200 Diesel Generator Set](../products/x/mlc200.md) (`mlc200`)\n',
    )
    expect(html).toContain('MLC200 Diesel Generator Set')
    expect(html).toContain('mlc200')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href=')
  })

  it('关闭自动识别 URL 为链接', () => {
    const html = renderKnowledgeDocumentMarkdown('访问 https://example.com 查看说明')
    expect(html).toContain('https://example.com')
    expect(html).not.toContain('<a ')
  })
})

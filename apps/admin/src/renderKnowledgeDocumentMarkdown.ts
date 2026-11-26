import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true })

// 预览只展示文字，不把 [标题](路径) 做成可点链接
markdown.renderer.rules.link_open = () => ''
markdown.renderer.rules.link_close = () => ''

export function renderKnowledgeDocumentMarkdown(content: string): string {
  return markdown.render(content || '')
}

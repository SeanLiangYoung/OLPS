import type { PageKind, PageRecord } from './types'

export function buildPageJobRequest(input: {
  draftId: string; knowledgeBaseId: string; operation: 'generate' | 'rewrite' | 'translate'
  form: { kind: PageKind; title: string; slug: string; brief: string; locale: string; keywords: string }
  source?: PageRecord | null; target?: PageRecord
}): Record<string, unknown> {
  if (!input.draftId || !input.knowledgeBaseId) throw new Error('草稿和知识库必填')
  if (!input.form.title.trim() || !input.form.slug.trim()) throw new Error('标题与 slug 必填')
  if (input.operation !== 'generate' && !input.source) throw new Error('改写和翻译需要源页面')
  const locale = input.operation === 'rewrite' ? input.source!.locale : input.form.locale
  if (!locale) throw new Error('目标语言必填')
  if (input.operation === 'translate' && locale === input.source?.locale) throw new Error('翻译目标语言必须与源语言不同')
  return {
    draftId: input.draftId, knowledgeBaseId: input.knowledgeBaseId, operation: input.operation,
    kind: input.form.kind, title: input.form.title.trim(), slug: input.form.slug.trim(), brief: input.form.brief,
    locale, pageId: input.source?.pageId, expectedUpdatedAt: input.source?.updatedAt,
    targetPageId: input.target?.pageId, targetExpectedUpdatedAt: input.target?.updatedAt,
    ...(input.form.kind === 'ads' ? { keywords: input.form.keywords.split(',').map(keyword => keyword.trim()).filter(Boolean) } : {}),
  }
}

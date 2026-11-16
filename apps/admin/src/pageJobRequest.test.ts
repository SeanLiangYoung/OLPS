import { expect, it } from 'vitest'
import { buildPageJobRequest } from './pageJobRequest'
import type { PageRecord } from './types'

const source = { pageId: 'source', kind: 'content', title: 'Product', slug: 'product', locale: 'en', updatedAt: '2026-10-25T00:00:00.000Z', translationGroupId: 'product' } as PageRecord
const form = { kind: 'content' as const, title: 'Produit', slug: 'produit', locale: 'fr', brief: 'Translate', keywords: '' }

it('改写请求携带源版本及原语言', () => {
  expect(buildPageJobRequest({ draftId: 'draft', knowledgeBaseId: 'kb', operation: 'rewrite', form, source })).toMatchObject({ pageId: 'source', expectedUpdatedAt: source.updatedAt, locale: 'en' })
})

it('翻译明确更新目标页面并携带目标版本', () => {
  const target = { ...source, pageId: 'target', locale: 'fr' }
  expect(buildPageJobRequest({ draftId: 'draft', knowledgeBaseId: 'kb', operation: 'translate', form, source, target })).toMatchObject({ targetPageId: 'target', targetExpectedUpdatedAt: target.updatedAt, locale: 'fr' })
})

it('缺少源页面或者目标语言时终止请求', () => {
  expect(() => buildPageJobRequest({ draftId: 'draft', knowledgeBaseId: 'kb', operation: 'rewrite', form })).toThrow('源页面')
  expect(() => buildPageJobRequest({ draftId: 'draft', knowledgeBaseId: 'kb', operation: 'generate', form: { ...form, locale: '' } })).toThrow('语言')
})

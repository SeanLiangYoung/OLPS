import { expect, it } from 'vitest'
import { createRewriteProposal, assertRewriteComponentsPreserved } from './page-rewrite-proposal.js'
import type { PageRecord } from '@olps/domain'

it('改写候选保留源页面标识、语言和收录设置且不改变源对象', () => {
  const source: PageRecord = { pageId: 'original', draftId: 'draft', siteId: null, kind: 'site', slug: 'home', title: '原页面', status: 'published', locale: 'zh', translationGroupId: 'group', seo: { title: '原标题', description: '原描述', robots: 'noindex,nofollow' }, body: { html: '<h1>原正文</h1>' }, createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z', publishedAt: null }
  const proposed = createRewriteProposal(source, { title: '新标题', slug: 'new', locale: 'en', seo: { title: '新标题', description: '新描述' }, body: { html: '<h1>新正文</h1>' } }, { jobId: 'job' })
  expect(source.body.html).toBe('<h1>原正文</h1>')
  expect(proposed).toMatchObject({ pageId: 'original', locale: 'zh', translationGroupId: 'group', seo: { robots: 'noindex,nofollow' }, metadata: { generation: { jobId: 'job' } } })
  expect(proposed.body.html).toBe('<h1>新正文</h1>')
})

it('改写不能删除已有询盘、地图和联系组件', () => {
  const source = { body: { html: '<form data-olps-inquiry></form><div data-olps-map></div>' } }
  expect(() => assertRewriteComponentsPreserved(source, { body: { html: '<h1>新内容</h1>' } })).toThrow('已有业务组件')
  expect(() => assertRewriteComponentsPreserved(source, { body: { html: '<form data-olps-inquiry></form><div data-olps-map></div><h1>新内容</h1>' } })).not.toThrow()
})

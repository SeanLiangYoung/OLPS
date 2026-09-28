import { describe, expect, it } from 'vitest'
import {
  pickReportCandidatePages,
  reportCandidatePagesPath,
} from './reportsPageLoading'

describe('报告候选页面加载', () => {
  it('已发布草稿仍从当前草稿 pages 接口取候选，不走网站已发布列表', () => {
    expect(reportCandidatePagesPath('draft-linked')).toBe('/api/drafts/draft-linked/pages')
    expect(reportCandidatePagesPath('draft-linked')).not.toContain('/api/sites/')
  })

  it('网站已发布页集与草稿 sandbox 页集可以不同，候选仅采用草稿页集', () => {
    const draftPages = [
      {
        pageId: 'page-draft-only',
        title: 'Sandbox 页',
        kind: 'site' as const,
        slug: 'd',
        status: 'draft' as const,
        updatedAt: '',
        seo: { title: '', description: '' },
        body: { html: '' },
      },
    ]
    const sitePublishedPages = [
      {
        pageId: 'page-live-only',
        title: '线上页',
        kind: 'site' as const,
        slug: 'l',
        status: 'published' as const,
        updatedAt: '',
        seo: { title: '', description: '' },
        body: { html: '' },
      },
    ]
    const candidates = pickReportCandidatePages(draftPages, sitePublishedPages)
    expect(candidates.map((p) => p.pageId)).toEqual(['page-draft-only'])
    expect(candidates.some((p) => p.pageId === 'page-live-only')).toBe(false)
  })
})

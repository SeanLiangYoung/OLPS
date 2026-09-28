import { describe, expect, it } from 'vitest'
import {
  buildCreateReportBody,
  inquiriesListPath,
  integrationsPath,
  reportsListPath,
  resolveBusinessDataScope,
  resolveLinkedSiteIdForDraft,
} from './draftBusinessContext'
import type { PublishedSite } from './types'

const sites: PublishedSite[] = [
  {
    siteId: 'site-only',
    name: '唯一网站',
    publicUrl: 'https://example.test/',
    publishedCommitId: 'abc',
  },
]

describe('resolveLinkedSiteIdForDraft', () => {
  it('草稿未关联网站时不得因账户仅有一个网站而选中该网站', () => {
    expect(resolveLinkedSiteIdForDraft(sites, null)).toBe('')
    expect(resolveLinkedSiteIdForDraft(sites, undefined)).toBe('')
    expect(resolveLinkedSiteIdForDraft(sites, '')).toBe('')
  })

  it('草稿已关联网站时返回该 siteId', () => {
    expect(resolveLinkedSiteIdForDraft(sites, 'site-only')).toBe('site-only')
    expect(resolveLinkedSiteIdForDraft(sites, 'site-other')).toBe('site-other')
  })
})

describe('resolveBusinessDataScope', () => {
  it('无 siteId 时使用草稿历史接口', () => {
    expect(resolveBusinessDataScope(null)).toBe('draft')
    expect(resolveBusinessDataScope(undefined)).toBe('draft')
  })

  it('有 siteId 时使用网站业务接口', () => {
    expect(resolveBusinessDataScope('site-only')).toBe('site')
  })
})

describe('business API paths', () => {
  it('未发布草稿查询 draft 作用域路径', () => {
    expect(inquiriesListPath('draft', 'draft-1', '', '')).toBe('/api/drafts/draft-1/inquiries')
    expect(inquiriesListPath('draft', 'draft-1', '', 'status=new')).toBe(
      '/api/drafts/draft-1/inquiries?status=new',
    )
    expect(reportsListPath('draft', 'draft-1', '')).toBe('/api/drafts/draft-1/reports')
    expect(integrationsPath('draft', 'draft-1', '')).toBe('/api/drafts/draft-1/integrations')
  })

  it('已发布草稿查询关联网站路径', () => {
    expect(inquiriesListPath('site', 'draft-1', 'site-a', '')).toBe(
      '/api/sites/site-a/inquiries',
    )
    expect(reportsListPath('site', 'draft-1', 'site-a')).toBe('/api/sites/site-a/reports')
    expect(integrationsPath('site', 'draft-1', 'site-a')).toBe('/api/sites/site-a/integrations')
  })
})

describe('buildCreateReportBody', () => {
  it('未关联网站时省略 siteId', () => {
    expect(buildCreateReportBody('draft-1', 'page-1', null)).toEqual({
      draftId: 'draft-1',
      pageId: 'page-1',
    })
  })

  it('已关联网站时附带 siteId', () => {
    expect(buildCreateReportBody('draft-1', 'page-1', 'site-a')).toEqual({
      draftId: 'draft-1',
      pageId: 'page-1',
      siteId: 'site-a',
    })
  })
})

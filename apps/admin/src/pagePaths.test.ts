import { describe, expect, it } from 'vitest'
import {
  draftPageDetailApiPath,
  draftPageDetailRoute,
  draftPageGuideApiPath,
  draftPageGuideValidateApiPath,
  draftPagePreviewApiPath,
} from './pagePaths'

describe('pagePaths', () => {
  it('页面详情路由包含 draftId 与 pageId', () => {
    expect(draftPageDetailRoute('draft-1', 'page-9')).toBe('/drafts/draft-1/pages/page-9')
  })

  it('页面详情与 Guide、Preview API 均在 draft 作用域下', () => {
    expect(draftPageDetailApiPath('draft-1', 'page-9')).toBe('/api/drafts/draft-1/pages/page-9')
    expect(draftPageGuideApiPath('draft-1', 'page-9')).toBe(
      '/api/drafts/draft-1/pages/page-9/guide',
    )
    expect(draftPageGuideValidateApiPath('draft-1', 'page-9')).toBe(
      '/api/drafts/draft-1/pages/page-9/guide/validate',
    )
    expect(draftPagePreviewApiPath('draft-1', 'page-9')).toBe(
      '/api/drafts/draft-1/pages/page-9/preview',
    )
  })
})

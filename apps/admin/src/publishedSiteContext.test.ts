import { describe, expect, it } from 'vitest'
import { pickPublishedSiteId } from './publishedSiteContext'
import type { PublishedSite } from './types'

describe('pickPublishedSiteId（兼容旧调用）', () => {
  const sites: PublishedSite[] = [
    {
      siteId: 'only-site',
      name: '唯一',
      publicUrl: null,
      publishedCommitId: 'x',
    },
  ]

  it('preferred 为空时不再自动选中唯一网站', () => {
    expect(pickPublishedSiteId(sites, null)).toBe('')
    expect(pickPublishedSiteId(sites, undefined)).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import { defaultSiteSettings } from '@olps/domain'
import { computeBuildPlan } from './plan.js'
import type { StoredPageJson } from './types.js'

describe('发布范围', () => {
  it('暂停发布的页面不进入 HTML、导航及 sitemap', () => {
    const page = (id: string, status: string): StoredPageJson => ({
      pageId: id, kind: 'content', slug: id, title: id, status: status as StoredPageJson['status'],
      locale: 'en', seo: { title: id, description: id }, body: { html: `<h1>${id}</h1>` },
    })
    const plan = computeBuildPlan({
      settings: defaultSiteSettings(), publishConfig: { publicSiteUrl: 'https://example.com' },
      pages: [page('visible', 'draft'), page('hidden', 'unpublished')],
    })
    expect(plan.map(file => file.relativePath)).not.toContain('hidden/index.html')
    expect(plan.find(file => file.relativePath === 'index.html')!.content).not.toContain('hidden')
    expect(plan.find(file => file.relativePath === 'sitemap.xml')!.content).not.toContain('hidden')
    expect(plan.map(file => file.relativePath)).toContain('visible/index.html')
  })
})

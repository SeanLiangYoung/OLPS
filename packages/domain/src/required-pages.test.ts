import { describe, expect, it } from 'vitest'
import {
  requiredPages,
  type RequiredPageDefinition,
} from './required-pages.js'
import type { PageRole } from './content.js'

const expectedRoles: PageRole[] = [
  'home',
  'about',
  'contact',
  'privacy',
  'terms',
  'cookies',
  'thank-you',
  'not-found',
]

describe('requiredPages', () => {
  it('导出八个必备页面角色', () => {
    expect(requiredPages).toHaveLength(8)
    expect(requiredPages.map((page) => page.role)).toEqual(expectedRoles)
  })

  it('提供默认 slug、noindex 与 sitemap 规则', () => {
    const byRole = Object.fromEntries(
      requiredPages.map((page) => [page.role, page]),
    ) as Record<PageRole, RequiredPageDefinition>

    expect(byRole.home.defaultSlug).toBe('')
    expect(byRole.home.noindex).toBe(false)
    expect(byRole.home.includeInSitemap).toBe(true)

    expect(byRole.about.defaultSlug).toBe('about')
    expect(byRole.contact.defaultSlug).toBe('contact')
    expect(byRole.privacy.defaultSlug).toBe('privacy-policy')
    expect(byRole.terms.defaultSlug).toBe('terms')
    expect(byRole.cookies.defaultSlug).toBe('cookie-policy')
    expect(byRole['thank-you'].defaultSlug).toBe('thank-you')
    expect(byRole['not-found'].defaultSlug).toBe('')

    expect(byRole['thank-you'].noindex).toBe(true)
    expect(byRole['thank-you'].includeInSitemap).toBe(false)
    expect(byRole['not-found'].noindex).toBe(true)
    expect(byRole['not-found'].includeInSitemap).toBe(false)

    for (const role of ['home', 'about', 'contact', 'privacy', 'terms', 'cookies'] as const) {
      expect(byRole[role].noindex).toBe(false)
      expect(byRole[role].includeInSitemap).toBe(true)
    }
  })
})

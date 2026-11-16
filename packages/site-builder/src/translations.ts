import type { SiteSettings } from '@olps/domain'
import { primaryAdsRouteSlug } from './public-routes.js'
import type { StoredPageJson } from './types.js'

export function listPageTranslations(page: StoredPageJson, pages: StoredPageJson[], settings: SiteSettings) {
  const related = page.translationGroupId
    ? pages.filter(candidate => candidate.translationGroupId === page.translationGroupId && candidate.status !== 'unpublished')
    : [page]
  const locales = new Set<string>()
  const alternatives = related.map(candidate => {
    if (locales.has(candidate.locale)) throw new Error(`翻译组 ${page.translationGroupId} 重复语言 ${candidate.locale}`)
    locales.add(candidate.locale)
    return { pageId: candidate.pageId, locale: candidate.locale, routeSlug: primaryAdsRouteSlug(candidate) ?? candidate.slug }
  })
  return { alternatives, missingLocales: settings.locales.filter(locale => !locales.has(locale)) }
}

import type { PageRecord } from './types'

export function missingPageLocales(page: PageRecord, pages: PageRecord[], locales: string[]): string[] {
  const related = page.translationGroupId
    ? pages.filter(candidate => candidate.translationGroupId === page.translationGroupId && candidate.status !== 'unpublished')
    : [page]
  return locales.filter(locale => !related.some(candidate => candidate.locale === locale))
}

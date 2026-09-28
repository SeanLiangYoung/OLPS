import { adsKeywordRouteSlug, listAdsKeywordRoutes } from './ads-pages.js'
import { sitePagePath } from './publish-urls.js'
import type { PublishConfig, StoredPageJson } from './types.js'

export type PublicRouteEntry = {
  routeSlug: string
  pageId: string
  title: string
  href: string
}

export function listPublicRoutes(pages: StoredPageJson[], publishConfig: PublishConfig): PublicRouteEntry[] {
  const entries: PublicRouteEntry[] = []
  for (const page of pages) {
    if (page.kind === 'ads' && page.body.ads) {
      for (const { routeSlug, keyword } of listAdsKeywordRoutes(page)) {
        entries.push({
          routeSlug,
          pageId: page.pageId,
          title: `${page.title} (${keyword})`,
          href: sitePagePath(publishConfig, routeSlug),
        })
      }
      continue
    }
    entries.push({
      routeSlug: page.slug,
      pageId: page.pageId,
      title: page.title,
      href: sitePagePath(publishConfig, page.slug),
    })
  }
  return entries.sort((a, b) => a.routeSlug.localeCompare(b.routeSlug))
}

export function pickDefaultEntryRoute(entries: PublicRouteEntry[], pages: StoredPageJson[]): PublicRouteEntry | null {
  if (entries.length === 0) {
    return null
  }
  const homePage = pages.find((p) => p.slug.toLowerCase() === 'home')
  if (homePage) {
    const homeRoute = entries.find((e) => e.pageId === homePage.pageId && e.routeSlug.toLowerCase() === 'home')
    if (homeRoute) {
      return homeRoute
    }
  }
  const sitePage = pages.find((p) => p.kind === 'site')
  if (sitePage) {
    const siteRoute = entries.find((e) => e.pageId === sitePage.pageId)
    if (siteRoute) {
      return siteRoute
    }
  }
  return entries[0] ?? null
}

export function primaryAdsRouteSlug(page: StoredPageJson): string | null {
  if (page.kind !== 'ads' || !page.body.ads?.keywordCluster[0]) {
    return null
  }
  return adsKeywordRouteSlug(page.slug, page.body.ads.keywordCluster[0])
}

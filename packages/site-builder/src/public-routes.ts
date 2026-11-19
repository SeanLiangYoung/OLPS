import { sitePagePath } from './publish-urls.js'
import type { PublishConfig, StoredPageJson } from './types.js'

export type PublicRouteEntry = {
  routeSlug: string
  pageId: string
  title: string
  href: string
}

export function listPublicRoutes(pages: StoredPageJson[], publishConfig: PublishConfig): PublicRouteEntry[] {
  const entries: PublicRouteEntry[] = pages.map((page) => ({
    routeSlug: page.slug,
    pageId: page.pageId,
    title: page.title,
    href: sitePagePath(publishConfig, page.slug),
  }))
  return entries.sort((a, b) => a.routeSlug.localeCompare(b.routeSlug))
}

export function pickDefaultEntryRoute(entries: PublicRouteEntry[], pages: StoredPageJson[]): PublicRouteEntry | null {
  if (entries.length === 0) {
    return null
  }
  const homePage = pages.find((p) => p.slug.toLowerCase() === 'home')
  if (homePage) {
    const homeRoute = entries.find((e) => e.pageId === homePage.pageId)
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

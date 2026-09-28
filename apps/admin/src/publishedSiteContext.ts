import type { PublishedSite } from './types'

export function pickPublishedSiteId(
  sites: PublishedSite[],
  preferredSiteId: string | null | undefined,
): string {
  if (preferredSiteId && sites.some((s) => s.siteId === preferredSiteId)) {
    return preferredSiteId
  }
  if (sites.length === 1) return sites[0]!.siteId
  return ''
}

export function publishedSiteRequiredMessage(): string {
  return '请先发布网站，或在工作区选择已发布网站后再查看线上数据'
}

import { resolveLinkedSiteIdForDraft } from './draftBusinessContext'
import type { PublishedSite } from './types'

/** @deprecated 使用 resolveLinkedSiteIdForDraft；不再因「仅有一个网站」自动选中 */
export function pickPublishedSiteId(
  sites: PublishedSite[],
  preferredSiteId: string | null | undefined,
): string {
  return resolveLinkedSiteIdForDraft(sites, preferredSiteId)
}

export function publishedSiteRequiredMessage(): string {
  return '当前草稿尚未关联已发布网站，无法按网站维度查看数据'
}

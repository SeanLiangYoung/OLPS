import type { PublishedSite } from './types'

export type BusinessDataScope = 'draft' | 'site'

export function resolveLinkedSiteIdForDraft(
  _sites: PublishedSite[],
  draftSiteId: string | null | undefined,
): string {
  if (!draftSiteId) return ''
  return draftSiteId
}

export function resolveBusinessDataScope(
  draftSiteId: string | null | undefined,
): BusinessDataScope {
  if (draftSiteId) return 'site'
  return 'draft'
}

export function inquiriesListPath(
  scope: BusinessDataScope,
  draftId: string,
  siteId: string,
  querySuffix: string,
): string {
  const base =
    scope === 'draft'
      ? `/api/drafts/${draftId}/inquiries`
      : `/api/sites/${siteId}/inquiries`
  return querySuffix ? `${base}?${querySuffix}` : base
}

export function reportsListPath(
  scope: BusinessDataScope,
  draftId: string,
  siteId: string,
): string {
  if (scope === 'draft') return `/api/drafts/${draftId}/reports`
  return `/api/sites/${siteId}/reports`
}

export function integrationsPath(
  scope: BusinessDataScope,
  draftId: string,
  siteId: string,
): string {
  if (scope === 'draft') return `/api/drafts/${draftId}/integrations`
  return `/api/sites/${siteId}/integrations`
}

export function draftPagesListPath(draftId: string): string {
  return `/api/drafts/${draftId}/pages`
}

export function buildCreateReportBody(
  draftId: string,
  pageId: string,
  draftSiteId: string | null | undefined,
): { draftId: string; pageId: string; siteId?: string } {
  if (draftSiteId) {
    return { draftId, pageId, siteId: draftSiteId }
  }
  return { draftId, pageId }
}

export function businessViewReady(scope: BusinessDataScope, siteId: string): boolean {
  if (scope === 'draft') return true
  return Boolean(siteId)
}

export function siteScopeBlockedMessage(): string {
  return '当前草稿尚未关联已发布网站，无法按网站维度加载数据'
}

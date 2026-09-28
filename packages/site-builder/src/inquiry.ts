import type { StoredPageJson } from './types.js'

export function pageNeedsInquiryEndpoint(page: StoredPageJson): boolean {
  const parts: string[] = [page.body.html ?? '']
  if (page.body.ads) {
    for (const screen of page.body.ads.screens) {
      parts.push(screen.html)
    }
  }
  return parts.some((html) => html.includes('data-olps-inquiry'))
}

export function buildInquiryApiPath(
  publicApiBaseUrl: string,
  siteId: string,
  pageId: string,
): string {
  const base = publicApiBaseUrl.replace(/\/+$/, '')
  return `${base}/api/public/${encodeURIComponent(siteId)}/inquiries?pageId=${encodeURIComponent(pageId)}`
}

export function assertInquiryConfig(
  pages: StoredPageJson[],
  publishConfig: { publicApiBaseUrl?: string; siteId?: string },
): void {
  const needs = pages.some((page) => pageNeedsInquiryEndpoint(page))
  if (!needs) {
    return
  }
  if (!publishConfig.publicApiBaseUrl?.trim()) {
    throw new Error('页面包含 data-olps-inquiry 表单，但 publish-config 缺少 publicApiBaseUrl')
  }
  if (!publishConfig.siteId?.trim()) {
    throw new Error('页面包含 data-olps-inquiry 表单，但 publish-config 缺少 siteId')
  }
}

import { adsRuntimeScript } from './ads-runtime.js'
import { applySeoToHtml, injectBeforeBodyClose } from './html-document.js'
import { buildInquiryApiPath } from './inquiry.js'
import { publicPageUrl } from './publish-urls.js'
import { slugifyKeyword } from './slugify-keyword.js'
import type { PublishConfig, StoredPageJson } from './types.js'

function wrapPublishedHtml(
  page: StoredPageJson,
  publishConfig: PublishConfig,
  html: string,
): string {
  if (page.kind !== 'ads' || !page.body.ads) {
    return html
  }
  const inquiryPath = buildInquiryApiPath(
    publishConfig.publicApiBaseUrl!,
    publishConfig.siteId!,
    page.pageId,
  )
  const payload = JSON.stringify(page.body.ads)
  const injection = adsRuntimeScript(payload, inquiryPath)
  if (html.includes('</body>')) {
    return html.replace('</body>', `${injection}\n</body>`)
  }
  return injectBeforeBodyClose(html, injection)
}

function keywordLandingHtml(page: StoredPageJson, publishConfig: PublishConfig, keyword: string, html: string): string {
  const base = wrapPublishedHtml(page, publishConfig, html)
  return base
    .replace('id="olps-ads-root"', `id="olps-ads-root" data-kw="${keyword.replaceAll('"', '')}"`)
    .replace(
      "const keyword = params.get('kw') || data.keywordCluster[0];",
      `const keyword = params.get('kw') || ${JSON.stringify(keyword)} || data.keywordCluster[0];`,
    )
}

export function adsKeywordRouteSlug(pageSlug: string, keyword: string): string {
  return `${pageSlug}--${slugifyKeyword(keyword)}`
}

export function renderPageHtml(
  page: StoredPageJson,
  publishConfig: PublishConfig,
  routeSlug: string,
  keyword?: string,
): string {
  const canonicalFallback = publicPageUrl(publishConfig, routeSlug) ?? undefined
  let html = applySeoToHtml(page.body.html, {
    locale: page.locale,
    seo: page.seo,
    canonicalFallback,
  })

  if (page.kind === 'ads' && page.body.ads && keyword) {
    html = keywordLandingHtml(page, publishConfig, keyword, html)
  }

  return html
}

export function listAdsKeywordRoutes(page: StoredPageJson): { routeSlug: string; keyword: string }[] {
  if (page.kind !== 'ads' || !page.body.ads) {
    return []
  }
  return page.body.ads.keywordCluster.map((keyword) => ({
    keyword,
    routeSlug: adsKeywordRouteSlug(page.slug, keyword),
  }))
}

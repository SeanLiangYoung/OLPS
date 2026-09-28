import { adsRuntimeScript } from './ads-runtime.js'
import { applySeoToHtml, injectBeforeBodyClose, setElementAttributeById } from './html-document.js'
import { buildInquiryApiPath, pageNeedsInquiryEndpoint } from './inquiry.js'
import { inquiryRuntimeScript } from './inquiry-runtime.js'
import { publicPageUrl, sitePathPrefix } from './publish-urls.js'
import { rewriteSiteAssetReferences } from './rewrite-asset-urls.js'
import { slugifyKeyword } from './slugify-keyword.js'
import type { PublishConfig, StoredPageJson } from './types.js'

function injectAdsBundle(
  page: StoredPageJson,
  publishConfig: PublishConfig,
  html: string,
  keyword: string,
): string {
  const inquiryPath = buildInquiryApiPath(
    publishConfig.publicApiBaseUrl!,
    publishConfig.siteId!,
    page.pageId,
  )
  const ads = page.body.ads
  if (!ads) {
    throw new Error('injectAdsBundle 需要 page.body.ads')
  }
  const prefix = sitePathPrefix(publishConfig)
  const adsForRuntime = {
    ...ads,
    screens: ads.screens.map((screen) => ({
      ...screen,
      html: rewriteSiteAssetReferences(screen.html, prefix),
    })),
  }
  const payload = JSON.stringify(adsForRuntime)
  const withRoot = setElementAttributeById(html, 'olps-ads-root', 'data-kw', keyword)
  const injection = `${adsRuntimeScript(payload, inquiryPath)}`
  return injectBeforeBodyClose(withRoot, injection)
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

  const prefix = sitePathPrefix(publishConfig)
  html = rewriteSiteAssetReferences(html, prefix)

  if (page.kind === 'ads' && page.body.ads && keyword) {
    html = injectAdsBundle(page, publishConfig, html, keyword)
  } else if (pageNeedsInquiryEndpoint(page)) {
    const inquiryPath = buildInquiryApiPath(
      publishConfig.publicApiBaseUrl!,
      publishConfig.siteId!,
      page.pageId,
    )
    html = injectBeforeBodyClose(html, inquiryRuntimeScript(inquiryPath))
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

import { adsRuntimeScript } from './ads-runtime.js'
import { applySeoToHtml, injectBeforeBodyClose, setElementAttributeById } from './html-document.js'
import { buildInquiryApiPath, pageNeedsInquiryEndpoint } from './inquiry.js'
import { inquiryRuntimeScript } from './inquiry-runtime.js'
import { publicPageUrl, sitePagePath, sitePathPrefix } from './publish-urls.js'
import { rewriteSiteAssetReferences } from './rewrite-asset-urls.js'
import { slugifyKeyword } from './slugify-keyword.js'
import type { PublishConfig, StoredPageJson } from './types.js'
import type { SiteSettings } from '@olps/domain'
import { listPageTranslations } from './translations.js'
import { applyVisitorSettings, escapeVisitorHtml } from './visitor-runtime.js'
import { rewritePageLinks } from './page-links.js'

function injectAdsBundle(
  page: StoredPageJson,
  publishConfig: PublishConfig,
  html: string,
  keyword: string,
  pages?: StoredPageJson[],
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
      html: rewriteSiteAssetReferences(pages ? rewritePageLinks(screen.html, publishConfig, pages) : screen.html, prefix),
    })),
  }
  const payload = JSON.stringify(adsForRuntime)
  const pagePaths = Object.fromEntries((pages ?? []).filter(target => target.status !== 'unpublished').map(target => {
    const keyword = target.kind === 'ads' ? target.body.ads?.keywordCluster[0] : undefined
    return [target.pageId, sitePagePath(publishConfig, keyword ? adsKeywordRouteSlug(target.slug, keyword) : target.slug)]
  }))
  const withRoot = setElementAttributeById(html, 'olps-ads-root', 'data-kw', keyword)
  const injection = `${adsRuntimeScript(payload, inquiryPath, pagePaths)}`
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
  context?: { settings: SiteSettings; pages: StoredPageJson[] },
): string {
  const canonicalFallback = publicPageUrl(publishConfig, routeSlug) ?? undefined
  const alternatives = context ? listPageTranslations(page, context.pages, context.settings).alternatives.flatMap(alternative => {
    const href = publicPageUrl(publishConfig, alternative.pageId === page.pageId ? routeSlug : alternative.routeSlug)
    return href ? [{ locale: alternative.locale, href }] : []
  }) : undefined
  const defaultAlternative = alternatives?.find(alternative => alternative.locale === context?.settings.defaultLocale)
  if (defaultAlternative) alternatives!.push({ locale: 'x-default', href: defaultAlternative.href })
  let html = applySeoToHtml(page.body.html, {
    locale: page.locale,
    seo: page.seo,
    canonicalFallback,
    alternatives,
  })

  const prefix = sitePathPrefix(publishConfig)
  html = rewriteSiteAssetReferences(html, prefix)
  if (context) html = rewritePageLinks(html, publishConfig, context.pages)

  if (page.kind === 'ads' && page.body.ads && keyword) {
    html = injectAdsBundle(page, publishConfig, html, keyword, context?.pages)
  } else if (pageNeedsInquiryEndpoint(page)) {
    const inquiryPath = buildInquiryApiPath(
      publishConfig.publicApiBaseUrl!,
      publishConfig.siteId!,
      page.pageId,
    )
    html = injectBeforeBodyClose(html, inquiryRuntimeScript(inquiryPath))
  }

  if (context) {
    const translations = listPageTranslations(page, context.pages, context.settings)
    const links = translations.alternatives.map(alternative => `<a hreflang="${escapeVisitorHtml(alternative.locale)}" href="${escapeVisitorHtml(`${prefix}/${alternative.routeSlug}/`)}"${alternative.pageId === page.pageId ? ' aria-current="page"' : ''}>${escapeVisitorHtml(alternative.locale)}</a>`)
    if (links.length > 1) html = injectBeforeBodyClose(html, `<nav data-olps-languages aria-label="Languages">${links.join(' ')}</nav>`)
    html = applyVisitorSettings(html, page, context.settings, publishConfig)
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

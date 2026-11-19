import { applySeoToHtml, injectBeforeBodyClose } from './html-document.js'
import { buildInquiryApiPath, pageNeedsInquiryEndpoint } from './inquiry.js'
import { inquiryRuntimeScript } from './inquiry-runtime.js'
import { publicPageUrl, sitePathPrefix } from './publish-urls.js'
import { rewriteSiteAssetReferences } from './rewrite-asset-urls.js'
import type { PublishConfig, StoredPageJson } from './types.js'

export function renderPageHtml(page: StoredPageJson, publishConfig: PublishConfig): string {
  const canonicalFallback = publicPageUrl(publishConfig, page.slug) ?? undefined
  let html = applySeoToHtml(page.body.html, {
    locale: page.locale,
    seo: page.seo,
    canonicalFallback,
  })

  const prefix = sitePathPrefix(publishConfig)
  html = rewriteSiteAssetReferences(html, prefix)

  if (pageNeedsInquiryEndpoint(page)) {
    const inquiryPath = buildInquiryApiPath(
      publishConfig.publicApiBaseUrl!,
      publishConfig.siteId!,
      page.pageId,
    )
    html = injectBeforeBodyClose(html, inquiryRuntimeScript(inquiryPath))
  }

  return html
}

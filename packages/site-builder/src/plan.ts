import { assertInquiryConfig } from './inquiry.js'
import { assertValidAdsPage, assertValidStoredPage } from './page-validation.js'
import { assertSafeSlug } from './paths.js'
import { listAdsKeywordRoutes, renderPageHtml } from './ads-pages.js'
import { listPublicRoutes, pickDefaultEntryRoute } from './public-routes.js'
import { publicPageUrl } from './publish-urls.js'
import { RouteRegistry } from './route-registry.js'
import type { LoadedWorkspace, PlannedFile, StoredPageJson } from './types.js'

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function buildSitemapXml(publishConfig: LoadedWorkspace['publishConfig'], routes: { slug: string; updatedAt?: string }[]): string {
  const body = routes.sort((a, b) => a.slug.localeCompare(b.slug)).flatMap(route => {
    const loc = publicPageUrl(publishConfig, route.slug)
    return loc ? [`  <url><loc>${escapeHtml(loc)}</loc>${route.updatedAt ? `<lastmod>${escapeHtml(route.updatedAt)}</lastmod>` : ''}</url>`] : []
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

function buildIndexHtml(pages: StoredPageJson[], publishConfig: LoadedWorkspace['publishConfig']): string {
  const routes = listPublicRoutes(pages, publishConfig)
  const defaultRoute = pickDefaultEntryRoute(routes, pages)
  const links = routes
    .map((route) => `<li><a href="${escapeHtml(route.href)}">${escapeHtml(route.title)}</a></li>`)
    .join('\n')

  const homeHref = defaultRoute?.href ?? routes[0]?.href ?? '/'
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Site index</title>
<meta name="robots" content="noindex"/>
</head>
<body>
<p><a href="${escapeHtml(homeHref)}">Enter site</a></p>
<ul>
${links}
</ul>
</body>
</html>
`
}

export function computeBuildPlan(loaded: LoadedWorkspace): PlannedFile[] {
  const { publishConfig, settings } = loaded
  const pages = loaded.pages.filter(page => page.status !== 'unpublished')
  assertInquiryConfig(pages, publishConfig)

  const registry = new RouteRegistry()
  const htmlOutputs: PlannedFile[] = []
  const sitemapSlugs: { slug: string; updatedAt?: string }[] = []

  for (const page of pages) {
    assertValidStoredPage(page)
    assertValidAdsPage(page, settings)
    assertSafeSlug(page.slug)

    if (page.kind === 'ads' && page.body.ads) {
      for (const { routeSlug, keyword } of listAdsKeywordRoutes(page)) {
        registry.register(routeSlug, page.pageId)
        if (page.seo.robots !== 'noindex,nofollow') sitemapSlugs.push({ slug: routeSlug, updatedAt: page.updatedAt })
        const content = renderPageHtml(page, publishConfig, routeSlug, keyword, { settings, pages })
        htmlOutputs.push({ relativePath: `${routeSlug}/index.html`, content })
      }
      continue
    }

    registry.register(page.slug, page.pageId)
    if (page.seo.robots !== 'noindex,nofollow') sitemapSlugs.push({ slug: page.slug, updatedAt: page.updatedAt })
    const content = renderPageHtml(page, publishConfig, page.slug, undefined, { settings, pages })
    htmlOutputs.push({ relativePath: `${page.slug}/index.html`, content })
  }

  htmlOutputs.push({ relativePath: 'index.html', content: buildIndexHtml(pages, publishConfig) })
  htmlOutputs.push({
    relativePath: 'sitemap.xml',
    content: buildSitemapXml(publishConfig, sitemapSlugs),
  })
  htmlOutputs.push({ relativePath: 'robots.txt', content: `User-agent: *\nAllow: /\n${publishConfig.publicSiteUrl ? `Sitemap: ${publishConfig.publicSiteUrl.replace(/\/+$/, '')}/sitemap.xml\n` : ''}` })

  return htmlOutputs.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

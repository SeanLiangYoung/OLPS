import { assertInquiryConfig } from './inquiry.js'
import { assertValidStoredPage } from './page-validation.js'
import { assertSafeSlug } from './paths.js'
import { renderPageHtml } from './render-page.js'
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

function buildSitemapXml(publishConfig: LoadedWorkspace['publishConfig'], routeSlugs: string[]): string {
  const locs = routeSlugs
    .map((slug) => publicPageUrl(publishConfig, slug))
    .filter((url): url is string => Boolean(url))
    .sort()

  const body = locs.map((loc) => `  <url><loc>${escapeHtml(loc)}</loc></url>`).join('\n')
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
  const { pages, publishConfig } = loaded
  assertInquiryConfig(pages, publishConfig)

  const registry = new RouteRegistry()
  const htmlOutputs: PlannedFile[] = []
  const sitemapSlugs: string[] = []

  for (const page of pages) {
    assertValidStoredPage(page)
    assertSafeSlug(page.slug)

    registry.register(page.slug, page.pageId)
    sitemapSlugs.push(page.slug)
    const content = renderPageHtml(page, publishConfig)
    htmlOutputs.push({ relativePath: `${page.slug}/index.html`, content })
  }

  htmlOutputs.push({ relativePath: 'index.html', content: buildIndexHtml(pages, publishConfig) })
  htmlOutputs.push({
    relativePath: 'sitemap.xml',
    content: buildSitemapXml(publishConfig, sitemapSlugs),
  })

  return htmlOutputs.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

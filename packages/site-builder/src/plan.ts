import { assertInquiryConfig } from './inquiry.js'
import { assertSafeSlug } from './paths.js'
import { listAdsKeywordRoutes, renderPageHtml } from './ads-pages.js'
import { publicPageUrl, sitePagePath } from './publish-urls.js'
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

function pickHomePage(pages: StoredPageJson[]): StoredPageJson | null {
  const home = pages.find((p) => p.slug === 'home')
  if (home) {
    return home
  }
  const sitePages = pages.filter((p) => p.kind === 'site').sort((a, b) => a.slug.localeCompare(b.slug))
  if (sitePages[0]) {
    return sitePages[0]
  }
  const sorted = [...pages].sort((a, b) => a.slug.localeCompare(b.slug))
  return sorted[0] ?? null
}

function buildIndexHtml(pages: StoredPageJson[], publishConfig: LoadedWorkspace['publishConfig']): string {
  const home = pickHomePage(pages)
  const links = [...pages]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((page) => {
      const href = sitePagePath(publishConfig, page.slug)
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(page.title)}</a></li>`
    })
    .join('\n')

  const homeHref = home ? sitePagePath(publishConfig, home.slug) : sitePagePath(publishConfig, 'home')
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

  const routeOwners = new Map<string, string>()
  const htmlOutputs: PlannedFile[] = []
  const sitemapSlugs: string[] = []

  for (const page of pages) {
    assertSafeSlug(page.slug)

    if (page.kind === 'ads' && page.body.ads) {
      for (const { routeSlug, keyword } of listAdsKeywordRoutes(page)) {
        assertSafeSlug(routeSlug.replace(/--/g, '-'))
        const owner = routeOwners.get(routeSlug)
        if (owner && owner !== page.pageId) {
          throw new Error(`关键词路由冲突: ${routeSlug}`)
        }
        routeOwners.set(routeSlug, page.pageId)
        sitemapSlugs.push(routeSlug)
        const content = renderPageHtml(page, publishConfig, routeSlug, keyword)
        htmlOutputs.push({ relativePath: `${routeSlug}/index.html`, content })
      }
      continue
    }

    const owner = routeOwners.get(page.slug)
    if (owner && owner !== page.pageId) {
      throw new Error(`重复 slug: ${page.slug}`)
    }
    routeOwners.set(page.slug, page.pageId)
    sitemapSlugs.push(page.slug)
    const content = renderPageHtml(page, publishConfig, page.slug)
    htmlOutputs.push({ relativePath: `${page.slug}/index.html`, content })
  }

  htmlOutputs.push({ relativePath: 'index.html', content: buildIndexHtml(pages, publishConfig) })
  htmlOutputs.push({
    relativePath: 'sitemap.xml',
    content: buildSitemapXml(publishConfig, sitemapSlugs),
  })

  return htmlOutputs.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

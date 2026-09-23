import fs from 'node:fs/promises'
import path from 'node:path'
import type { PageRecord, SiteRecord } from '@olps/domain'
import { appConfig } from './config.js'
import { adsRuntimeScript } from './ads-runtime.js'
import { listPages } from './store.js'

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

function publicBase(site: SiteRecord): string {
  return path.join(appConfig.publishRoot, site.tenantId, site.siteId)
}

function pageFileName(page: PageRecord): string {
  if (page.kind === 'ads') {
    // 一词一址：为每个关键词写独立目录
    return page.slug
  }
  return page.slug
}

function wrapPublishedHtml(page: PageRecord, site: SiteRecord, html: string): string {
  if (page.kind !== 'ads' || !page.body.ads) return html
  const payload = JSON.stringify(page.body.ads)
  const inquiryPath = `/api/public/${site.tenantId}/${site.siteId}/inquiries?pageId=${encodeURIComponent(page.pageId)}`
  const injection = adsRuntimeScript(payload, inquiryPath)
  if (html.includes('</body>')) {
    return html.replace('</body>', `${injection}\n</body>`)
  }
  return `${html}\n${injection}`
}

function keywordLandingHtml(page: PageRecord, site: SiteRecord, keyword: string): string {
  const base = wrapPublishedHtml(page, site, page.body.html)
  // 通过 query 指定入口词；文件路径已按词分开
  return base.replace(
    'id="olps-ads-root"',
    `id="olps-ads-root" data-kw="${keyword.replaceAll('"', '')}"`,
  ).replace(
    'const keyword = params.get(\'kw\') || data.keywordCluster[0];',
    `const keyword = params.get('kw') || ${JSON.stringify(keyword)} || data.keywordCluster[0];`,
  )
}

export async function publishPage(site: SiteRecord, page: PageRecord): Promise<string[]> {
  const urls: string[] = []
  const base = publicBase(site)
  await ensureDir(base)

  if (page.kind === 'ads' && page.body.ads) {
    for (const keyword of page.body.ads.keywordCluster) {
      const slug = `${page.slug}--${slugifyKeyword(keyword)}`
      const dir = path.join(base, slug)
      await ensureDir(dir)
      const html = keywordLandingHtml(page, site, keyword)
      await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8')
      urls.push(`/p/${site.tenantId}/${site.siteId}/${slug}/`)
    }
  } else {
    const dir = path.join(base, pageFileName(page))
    await ensureDir(dir)
    await fs.writeFile(path.join(dir, 'index.html'), page.body.html, 'utf8')
    urls.push(`/p/${site.tenantId}/${site.siteId}/${page.slug}/`)
  }

  await writeSitemap(site)
  return urls
}

function slugifyKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function writeSitemap(site: SiteRecord): Promise<string> {
  const pages = await listPages(site.tenantId, site.siteId, { status: 'published' })
  const urls: string[] = []
  for (const page of pages) {
    if (page.kind === 'ads' && page.body.ads) {
      for (const keyword of page.body.ads.keywordCluster) {
        const slug = `${page.slug}--${slugifyKeyword(keyword)}`
        urls.push(`/p/${site.tenantId}/${site.siteId}/${slug}/`)
      }
    } else {
      urls.push(`/p/${site.tenantId}/${site.siteId}/${page.slug}/`)
    }
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (loc) => `  <url><loc>${loc}</loc><lastmod>${new Date().toISOString()}</lastmod></url>`,
  )
  .join('\n')}
</urlset>
`
  const base = publicBase(site)
  await ensureDir(base)
  await fs.writeFile(path.join(base, 'sitemap.xml'), body, 'utf8')
  return `/p/${site.tenantId}/${site.siteId}/sitemap.xml`
}

export async function writePreview(site: SiteRecord, page: PageRecord): Promise<string> {
  const dir = path.join(appConfig.previewRoot, site.tenantId, site.siteId, page.pageId)
  await ensureDir(dir)
  const html =
    page.kind === 'ads' && page.body.ads
      ? wrapPublishedHtml(page, site, page.body.html)
      : page.body.html
  await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8')
  return `/preview/${site.tenantId}/${site.siteId}/${page.pageId}/`
}

import { Readable } from 'node:stream'
import { Feed } from 'feed'
import TurndownService from 'turndown'
import { SitemapIndexStream, SitemapStream, streamToPromise, type SitemapItemLoose } from 'sitemap'
import { parse } from 'parse5'
import { buildSeoHead, type SiteModel } from '@olps/render'
import type { PublicHtmlRoute } from './public-html-routes.js'
import { bodyHtml, siteAbsoluteUrl, walkHtml } from './html-output.js'
import type { OutputFile } from './types.js'

function updatedAt(model: SiteModel, route: PublicHtmlRoute): string {
  const target = route.target
  if (target.kind === 'page') return model.pages.find(page => page.meta.pageId === target.pageId)!.locales[route.locale].updatedAt
  const collection = model.collections.find(item => item.definition.collectionId === target.collectionId)!
  if (target.kind === 'collection') return collection.indexLocales[route.locale].updatedAt
  if (target.kind === 'group') return collection.groups.find(group => group.meta.groupId === target.groupId)!.locales[route.locale].updatedAt
  return collection.items.find(item => item.meta.itemId === target.itemId)!.locales[route.locale].updatedAt
}

function includeInSitemap(model: SiteModel, route: PublicHtmlRoute): boolean {
  if (route.pageNumber !== 1) return false
  if (route.target.kind !== 'page') return true
  const pageId = route.target.pageId
  const role = model.pages.find(page => page.meta.pageId === pageId)!.meta.role
  return role !== 'thank-you' && role !== 'not-found'
}

function robots(model: SiteModel): string {
  const { allowIndexing, allowAiSearch, allowAiTraining } = model.settings.search
  const lines = ['User-agent: *', allowIndexing ? 'Allow: /' : 'Disallow: /', '']
  for (const agent of ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot']) {
    lines.push(`User-agent: ${agent}`, allowIndexing && allowAiSearch ? 'Allow: /' : 'Disallow: /', '')
  }
  for (const agent of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Applebot-Extended']) {
    lines.push(`User-agent: ${agent}`, allowIndexing && allowAiTraining ? 'Allow: /' : 'Disallow: /', '')
  }
  lines.push(`Sitemap: ${siteAbsoluteUrl(model.settings.siteUrl, '/sitemap.xml')}`, '')
  return lines.join('\n')
}

function imagesInHtml(model: SiteModel, html: string, route: PublicHtmlRoute): string[] {
  const images = new Set<string>()
  const url = siteAbsoluteUrl(model.settings.siteUrl, route.url)
  walkHtml(parse(html), element => {
    if (element.tagName !== 'img') return
    const src = element.attrs.find(attr => attr.name === 'src')?.value
    if (!src || src.startsWith('data:')) return
    images.add(new URL(src, url).href)
  })
  return [...images]
}

async function sitemap(entries: SitemapItemLoose[]): Promise<string> {
  if (!entries.length) return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>'
  const stream = new SitemapStream()
  return (await streamToPromise(Readable.from(entries).pipe(stream))).toString('utf8')
}

export async function planHiddenFiles(model: SiteModel, routes: PublicHtmlRoute[], htmlFiles: OutputFile[], mode: 'publish' | 'preview' = 'publish'): Promise<OutputFile[]> {
  if (mode === 'preview') return []
  const files: OutputFile[] = []
  const htmlByPath = new Map(htmlFiles.map(file => [file.relativePath.replace(/^public\//, ''), String(file.content)]))
  const markdown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  const fullTexts = new Map<string, string[]>()
  const sitemapGroups = new Map<string, SitemapItemLoose[]>([['sitemap-pages.xml', []]])
  for (const collection of model.collections) {
    if (collection.definition.status === 'published') sitemapGroups.set(`sitemap-${collection.definition.collectionId}.xml`, [])
  }
  const important: string[] = [`# ${model.settings.siteName}`, '', `> ${model.settings.company.name}`, '']
  for (const route of routes) {
    const html = htmlByPath.get(route.relativePath)
    if (html === undefined) throw new Error(`隐藏文件缺少页面 HTML：${route.relativePath}`)
    const seo = buildSeoHead(model, { ...route.target, locale: route.locale, mode: 'publish' })
    const content = markdown.turndown(bodyHtml(html))
    const absolute = siteAbsoluteUrl(model.settings.siteUrl, route.url)
    const markdownPath = route.relativePath.replace(/\.html$/, '.md')
    files.push({ relativePath: markdownPath, content: `${content}\n` })
    const texts = fullTexts.get(route.locale) ?? []
    texts.push(`# ${seo.title}\n\nSource: ${absolute}\n\n${content}\n`)
    fullTexts.set(route.locale, texts)
    if (route.pageNumber === 1 && includeInSitemap(model, route)) important.push(`- [${seo.title}](${absolute})`)
    if (!includeInSitemap(model, route)) continue
    const name = route.target.kind === 'page' ? 'sitemap-pages.xml' : `sitemap-${route.target.collectionId}.xml`
    const entries = sitemapGroups.get(name)!
    entries.push({
      url: absolute, lastmod: updatedAt(model, route),
      links: seo.hreflang.map(link => ({ lang: link.hreflang, url: link.href })),
      img: imagesInHtml(model, html, route),
    })
  }
  for (const [name, entries] of sitemapGroups) files.push({ relativePath: name, content: await sitemap(entries) })
  const index = new SitemapIndexStream()
  files.push({ relativePath: 'sitemap.xml', content: (await streamToPromise(Readable.from([...sitemapGroups.keys()].map(name => ({ url: siteAbsoluteUrl(model.settings.siteUrl, name) }))).pipe(index))).toString('utf8') })
  files.push({ relativePath: 'robots.txt', content: robots(model) }, { relativePath: 'llms.txt', content: `${important.join('\n')}\n` })
  for (const locale of model.settings.locales) files.push({ relativePath: `${locale.code}/llms-full.txt`, content: (fullTexts.get(locale.code) ?? []).join('\n') })
  if (model.publishConfig.indexNowKey) {
    if (!/^[a-zA-Z0-9-]+$/.test(model.publishConfig.indexNowKey)) throw new Error('IndexNow 密钥格式无效')
    files.push({ relativePath: `${model.publishConfig.indexNowKey}.txt`, content: model.publishConfig.indexNowKey })
  }
  for (const collection of model.collections) {
    if (!collection.definition.feed || collection.definition.status !== 'published') continue
    for (const locale of model.settings.locales) {
      const indexLocale = collection.indexLocales[locale.code]
      if (!indexLocale) continue
      const prefix = `${locale.code}/${collection.definition.prefix}`
      const link = siteAbsoluteUrl(model.settings.siteUrl, `${prefix}/`)
      const feed = new Feed({ title: indexLocale.title, description: indexLocale.summary, id: link, link, language: locale.code, updated: new Date(collection.definition.updatedAt), copyright: model.settings.company.name, feedLinks: { rss: `${link}feed.xml` } })
      for (const route of routes) {
        if (route.locale !== locale.code || route.target.kind !== 'item' || route.target.collectionId !== collection.definition.collectionId) continue
        const itemId = route.target.itemId
        const item = collection.items.find(candidate => candidate.meta.itemId === itemId)!
        const localized = item.locales[locale.code]
        feed.addItem({ title: localized.title, link: siteAbsoluteUrl(model.settings.siteUrl, route.url), date: new Date(localized.updatedAt), description: localized.summary, content: bodyHtml(htmlByPath.get(route.relativePath)!) })
      }
      files.push({ relativePath: `${prefix}/feed.xml`, content: feed.rss2() })
    }
  }
  return files
}

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { loadSiteModel } from '@olps/render'
import { createFsSourceReader } from './load.js'
import { collectPublicHtmlRoutes } from './public-html-routes.js'
import { planHiddenFiles } from './hidden-files.js'
import { planRedirects } from './redirects.js'
import { planServerConfig } from './server-config.js'
import { buildSearchIndex } from './search-index.js'
import { planNotFound } from './not-found.js'
import { planSiteIcons } from './site-icons.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = path.join(root, 'packages/render/test-fixtures/sites/full-site')

describe('整站辅助产物', () => {
  it('根地址和两个旧地址的HTML跳转保留来源参数与页面片段',async()=>{
    const model=await loadSiteModel(createFsSourceReader(fixture))
    const about=model.pages.find(page=>page.meta.role==='about')!
    model.redirects.redirects=['old-about','previous/about'].map((slug,index)=>({redirectId:`source-${index}`,locale:'en',from:`/en/${slug}/`,target:{ref:'page',id:about.meta.pageId},createdAt:'2026-11-20T00:00:00.000Z'}))
    const files=new Map(planRedirects(model).map(file=>[file.relativePath,String(file.content)]))
    const server=createServer((request,response)=>{
      const originalPath=new URL(request.url!,'http://localhost').pathname
      const pathname=originalPath.startsWith('/company/')?originalPath.slice('/company'.length):originalPath
      const file=files.get(`${pathname.slice(1)}index.html`)
      response.writeHead(200,{'Content-Type':'text/html'});response.end(file??'<!doctype html><title>Destination</title>')
    })
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const browser=await chromium.launch({headless:true})
    try{
      const page=await browser.newPage(),base=`http://127.0.0.1:${(server.address() as {port:number}).port}`
      for(const prefix of ['','/company'])for(const from of ['/','/en/old-about/','/en/previous/about/']){
        await page.goto(`${base}${prefix}${from}?utm_source=redirect-check&gclid=click%2Bid#campaign`)
        await page.waitForURL(url=>url.pathname===`${prefix}${from==='/'?'/en/':'/en/about/'}`)
        const destination=new URL(page.url())
        expect(destination.search).toBe('?utm_source=redirect-check&gclid=click%2Bid')
        expect(destination.hash).toBe('#campaign')
      }
    }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
  })
  it('404 模板的 CSS 与 srcset 资源在子目录使用绝对地址', async () => {
    const parent = path.join(root, '.intermediate', 'auxiliary-output-tests')
    await fs.mkdir(parent, { recursive: true })
    const workspace = await fs.mkdtemp(path.join(parent, 'notfound-css-'))
    try {
      await fs.cp(fixture, workspace, { recursive: true })
      await fs.cp(path.join(root, 'packages/builtin-themes/starter'), path.join(workspace, 'themes/starter'), { recursive: true })
      await fs.writeFile(path.join(workspace, 'themes/starter/templates/page-not-found.liquid'), '<!doctype html><html lang="{{ locale.code }}"><head><style>.background{background-image:url("/assets/uploads/background.png")}</style></head><body><main class="background" style="border-image-source:url(../assets/uploads/border.png)">{{ content }}<img alt="背景" src="/assets/uploads/background.png" srcset="/assets/uploads/background.png 480w, ../assets/uploads/border.png 960w"></main></body></html>')
      const reader = createFsSourceReader(workspace)
      const model = await loadSiteModel(reader)
      model.settings.siteUrl = 'https://www.example.com/company'
      const files = await planNotFound(model, reader)
      for (const file of files) {
        const html = String(file.content)
        expect(html).toContain('background-image:url(https://www.example.com/company/assets/uploads/background.png)')
        expect(html).toContain('border-image-source:url(https://www.example.com/company/assets/uploads/border.png)')
        expect(html).toContain('srcset="https://www.example.com/company/assets/uploads/background.png 480w, https://www.example.com/company/assets/uploads/border.png 960w"')
      }
      const preview = await planNotFound(model, reader, 'preview')
      const rootPreview = String(preview.find(file => file.relativePath === '404.html')!.content)
      expect(rootPreview).toContain('background-image:url(assets/uploads/background.png)')
      expect(rootPreview).toContain('border-image-source:url(assets/uploads/border.png)')
    } finally { await fs.rm(workspace, { recursive: true, force: true }) }
  })

  it('404 页面使用网站绝对地址并生成默认语言副本', async () => {
    const parent = path.join(root, '.intermediate', 'auxiliary-output-tests')
    await fs.mkdir(parent, { recursive: true })
    const workspace = await fs.mkdtemp(path.join(parent, 'notfound-'))
    try {
      await fs.cp(fixture, workspace, { recursive: true })
      await fs.cp(path.join(root, 'packages/builtin-themes/starter'), path.join(workspace, 'themes/starter'), { recursive: true })
      const reader = createFsSourceReader(workspace)
      const model = await loadSiteModel(reader)
      const files = await planNotFound(model, reader)
      expect(files.map(file => file.relativePath).sort()).toEqual(['404.html', 'en/404.html', 'zh-CN/404.html'])
      expect(String(files[0].content)).toContain('<base href="https://www.example.com/">')
      expect(String(files[0].content)).toContain('name="robots" content="noindex')
      expect(String(files[0].content)).toContain('href="https://www.example.com/en/')
      const preview = await planNotFound(model, reader, 'preview')
      const rootPreview = String(preview.find(file => file.relativePath === '404.html')!.content)
      expect(rootPreview).not.toContain('<base ')
      expect(rootPreview).not.toContain('data-olps-tracking-config')
      expect(rootPreview).toContain('href="en/')
      expect(rootPreview).not.toContain('href="../')
    } finally { await fs.rm(workspace, { recursive: true, force: true }) }
  })

  it('真实媒体图标生成 favicon、PNG 与 webmanifest', async () => {
    const parent = path.join(root, '.intermediate', 'auxiliary-output-tests')
    await fs.mkdir(parent, { recursive: true })
    const workspace = await fs.mkdtemp(path.join(parent, 'icons-'))
    try {
      const model = await loadSiteModel(createFsSourceReader(fixture))
      const content = await sharp({ create: { width: 256, height: 256, channels: 4, background: '#225588' } }).png().toBuffer()
      await fs.mkdir(path.join(workspace, 'assets/uploads'), { recursive: true })
      await fs.writeFile(path.join(workspace, 'assets/uploads/icon.png'), content)
      model.settings.iconMediaId = '77777777-7777-4777-8777-777777777777'
      model.media.push({ schemaVersion: 1, mediaId: model.settings.iconMediaId, path: 'assets/uploads/icon.png', mimeType: 'image/png', size: content.length, width: 256, height: 256, title: {}, alt: {}, caption: {}, uploadedBy: '00000000-0000-4000-8000-000000000001', uploadedAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' })
      const files = await planSiteIcons(workspace, model)
      expect(files.map(file => file.relativePath)).toContain('favicon.ico')
      expect(files.map(file => file.relativePath)).toContain('apple-touch-icon.png')
      const manifest = JSON.parse(String(files.find(file => file.relativePath === 'manifest.webmanifest')!.content))
      expect(manifest.name).toBe(model.settings.siteName)
      for (const icon of manifest.icons) expect(files.some(file => file.relativePath === icon.src)).toBe(true)
    } finally { await fs.rm(workspace, { recursive: true, force: true }) }
  })

  it('生成 sitemap、robots、Markdown、语言全文、RSS 和 IndexNow 文件', async () => {
    const model = await loadSiteModel(createFsSourceReader(fixture))
    const routes = collectPublicHtmlRoutes(model)
    const html = routes.map(route => ({ relativePath: route.relativePath, content: `<html lang="${route.locale}"><head><title>Acme</title></head><body><main><h1>Acme</h1><p>Manufacturing</p></main></body></html>` }))
    const files = await planHiddenFiles(model, routes, html)
    const byPath = new Map(files.map(file => [file.relativePath, String(file.content)]))
    expect(byPath.get('sitemap.xml')).toContain('sitemap-pages.xml')
    expect(byPath.get('sitemap-pages.xml')).toContain('xhtml:link')
    expect(byPath.get('robots.txt')).toContain('User-agent: GPTBot\nDisallow: /')
    expect(byPath.get('robots.txt')).toContain('Sitemap: https://www.example.com/sitemap.xml')
    expect(byPath.get('en/index.md')).toContain('# Acme')
    expect(byPath.get('zh-CN/llms-full.txt')).toContain('Manufacturing')
    expect(byPath.get('llms.txt')).toContain('https://www.example.com/en/')
    expect(byPath.get(`${model.publishConfig.indexNowKey}.txt`)).toBe(model.publishConfig.indexNowKey)
    expect(byPath.get('en/news/feed.xml')).toContain('<rss')
    const thankYou = model.pages.find(page => page.meta.role === 'thank-you')!
    expect(byPath.get('sitemap-pages.xml')).not.toContain(`/${thankYou.locales.en.slug}/`)
  })

  it('两个旧地址同时生成跳转页面与四种服务器配置', async () => {
    const model = await loadSiteModel(createFsSourceReader(fixture))
    const about = model.pages.find(page => page.meta.role === 'about')!
    model.redirects.redirects = ['old-about', 'previous/about'].map((slug, index) => ({
      redirectId: `redirect-${index}`, locale: 'en', from: `/en/${slug}/`, target: { ref: 'page', id: about.meta.pageId }, createdAt: '2026-11-20T00:00:00.000Z',
    }))
    const pages = planRedirects(model)
    expect(pages).toHaveLength(3)
    expect(String(pages[1].content)).toContain('http-equiv="refresh"')
    expect(String(pages[1].content)).toContain('location.replace')
    expect(String(pages[1].content)).toContain('https://www.example.com/en/about/')
    const configs = planServerConfig(model)
    expect(String(configs.find(file=>file.relativePath==='server-config/nginx.conf')!.content)).toContain('/en/about/$is_args$args')
    expect(configs.map(file => file.relativePath).sort()).toEqual(['server-config/.htaccess', 'server-config/_redirects', 'server-config/nginx.conf', 'server-config/web.config'])
    for (const config of configs) {
      expect(String(config.content)).toContain('old-about')
      expect(String(config.content)).toContain('previous/about')
      expect(String(config.content)).toContain(config.relativePath.endsWith('web.config') ? 'redirectType="Permanent"' : '301')
    }
  })

  it('跳转不能覆盖现有条目，子目录服务器配置使用对应路径', async () => {
    const model = await loadSiteModel(createFsSourceReader(fixture))
    const about = model.pages.find(page => page.meta.role === 'about')!
    const collection = model.collections.find(collection => collection.items.length > 0)!
    const item = collection.items.find(item => item.locales.en)!
    model.redirects.redirects = [{ redirectId: 'redirect', locale: 'en', from: `/en/${collection.definition.prefix}/${item.locales.en.slug}/`, target: { ref: 'page', id: about.meta.pageId }, createdAt: '2026-11-20T00:00:00.000Z' }]
    expect(() => planRedirects(model)).toThrow(/冲突/)
    model.redirects.redirects[0].from = '/en/previous/'
    model.publishConfig.hostingBasePath = '/company/'
    const configs = planServerConfig(model)
    expect(String(configs.find(file => file.relativePath.endsWith('web.config'))!.content)).toContain('url="^en/previous/$"')
    expect(String(configs.find(file => file.relativePath.endsWith('_redirects'))!.content)).toContain('/company/* /company/404.html 404')
  })

  it('Pagefind 为两种语言生成索引并在 Chromium 返回结果', async () => {
    const htmlFiles = [
      { relativePath: 'en/index.html', content: '<html lang="en"><head><title>Factory</title></head><body><main>Manufacturing machinery</main></body></html>' },
      { relativePath: 'zh-CN/index.html', content: '<html lang="zh-CN"><head><title>工厂</title></head><body><main>制造机械产品</main></body></html>' },
    ]
    const files = await buildSearchIndex(htmlFiles)
    expect(files.some(file => file.relativePath === 'pagefind/pagefind.js')).toBe(true)
    expect(files.some(file => file.relativePath.includes('pagefind.en_'))).toBe(true)
    expect(files.some(file => file.relativePath.includes('pagefind.zh-cn_'))).toBe(true)
    const byPath = new Map([...files, ...htmlFiles].map(file => [file.relativePath, file.content]))
    const server = createServer((request, response) => {
      const pathname = new URL(request.url!, 'http://localhost').pathname
      const relative = pathname.slice(1) + (pathname.endsWith('/') ? 'index.html' : '')
      const content = byPath.get(relative)
      if (content === undefined) { response.writeHead(404).end(); return }
      const type = relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.html') ? 'text/html' : relative.endsWith('.json') ? 'application/json' : 'application/octet-stream'
      response.writeHead(200, { 'Content-Type': type }).end(content)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('搜索测试服务器缺少地址')
    const browser = await chromium.launch({ headless: true })
    try {
      for (const [locale, query] of [['en', 'manufacturing'], ['zh-CN', '制造']]) {
        const page = await browser.newPage()
        await page.goto(`http://127.0.0.1:${address.port}/${locale}/`)
        const result = await page.evaluate(`(async () => {
          const pagefind = await import('/pagefind/pagefind.js');
          const results = await pagefind.search(${JSON.stringify(query)});
          return Promise.all(results.results.map(item => item.data()));
        })()`)
        expect(result).toHaveLength(1)
        expect(result[0].url).toContain(`/${locale}/`)
        await page.close()
      }
    } finally {
      await browser.close()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})

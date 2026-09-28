import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as parse5 from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import { buildSite, installSiteBuilder, verifySite } from './index.js'
import { buildInquiryApiPath } from './inquiry.js'
import { spawn } from 'node:child_process'
import { sitePathPrefix } from './publish-urls.js'
import { slugifyKeyword } from './slugify-keyword.js'
import { fileURLToPath } from 'node:url'

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(packageRoot, '../..')

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function seedBase(root: string): Promise<void> {
  await writeJson(path.join(root, 'source', 'site-settings.json'), {
    defaultLocale: 'en',
    locales: ['en'],
    screenCap: 20,
    analyticsEnabled: false,
    mapsEnabled: false,
    mapsApiKey: '',
    whatsappEnabled: false,
    whatsappNumber: '',
    whatsappLabel: '',
  })
  await writeJson(path.join(root, 'source', 'publish-config.json'), {
    publicSiteUrl: 'https://example.test/s/rs-site-1',
    publicApiBaseUrl: 'http://127.0.0.1:0',
    siteId: 'site-uuid-1',
  })
  await writeJson(path.join(root, 'olps.manifest.json'), {
    schemaVersion: 1,
    buildCommand: ['node', 'legacy.js'],
    verifyCommand: ['node', 'legacy.js'],
  })
}

function startStaticSiteServer(publicDir: string, remoteId: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const prefix = `/s/${remoteId}/`
      if (!req.url?.startsWith(prefix)) {
        res.statusCode = 404
        res.end('not found')
        return
      }
      let rel = req.url.slice(prefix.length).split('?')[0] ?? ''
      if (rel.endsWith('/')) {
        rel = `${rel}index.html`
      }
      const filePath = path.join(publicDir, rel.replace(/\//g, path.sep))
      try {
        const data = await fs.readFile(filePath)
        res.statusCode = 200
        res.end(data)
      } catch {
        res.statusCode = 404
        res.end('missing')
      }
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('无法绑定测试 HTTP 端口'))
        return
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}/s/${remoteId}`,
        close: () =>
          new Promise<void>((done, err) => {
            server.close((e) => (e ? err(e) : done()))
          }),
      })
    })
  })
}

type HtmlChild = DefaultTreeAdapterMap['childNode']
type HtmlElement = DefaultTreeAdapterMap['element']

function isHtmlElement(node: HtmlChild): node is HtmlElement {
  return 'tagName' in node
}

function findElementById(html: string, elementId: string): HtmlElement | null {
  const doc = parse5.parse(html) as DefaultTreeAdapterMap['document']
  let found: HtmlElement | null = null
  const walk = (node: HtmlChild) => {
    if (found) {
      return
    }
    if (isHtmlElement(node)) {
      if (node.attrs.some((a) => a.name === 'id' && a.value === elementId)) {
        found = node
        return
      }
      for (const child of node.childNodes) {
        walk(child)
      }
    }
  }
  for (const child of doc.childNodes) {
    walk(child)
  }
  return found
}

function elementAttr(el: HtmlElement, name: string): string | null {
  return el.attrs.find((a) => a.name === name)?.value ?? null
}

function collectAnchorHrefs(html: string): string[] {
  const doc = parse5.parse(html)
  const hrefs: string[] = []
  const walk = (node: parse5.DefaultTreeAdapterMap['childNode']) => {
    if ('tagName' in node && node.tagName === 'a') {
      const href = node.attrs.find((a) => a.name === 'href')?.value
      if (href) hrefs.push(href)
    }
    if ('childNodes' in node) {
      for (const child of node.childNodes) walk(child)
    }
  }
  walk(doc as parse5.DefaultTreeAdapterMap['element'])
  return hrefs
}

describe('site-builder 审查补测', () => {
  let workspace: string

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('npm', ['run', 'build', '-w', '@olps/site-builder'], {
        cwd: repoRoot,
        shell: true,
        stdio: 'inherit',
      })
      proc.on('error', reject)
      proc.on('close', (code: number) => (code === 0 ? resolve() : reject(new Error(`build ${code}`))))
    })
  })

  beforeEach(async () => {
    workspace = path.join(repoRoot, '.intermediate', 'site-builder-coverage', `${Date.now()}-${Math.random()}`)
    await fs.mkdir(workspace, { recursive: true })
    await seedBase(workspace)
  })

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('首页与仅广告站入口链接指向真实 keyword 路由且 HTTP 可访问', async () => {
    await writeJson(path.join(workspace, 'source', 'pages', 'ads-1.json'), {
      pageId: 'ads-1',
      kind: 'ads',
      slug: 'campaign',
      title: 'Campaign',
      status: 'published',
      locale: 'en',
      seo: { title: 'Ads', description: 'Ads' },
      body: {
        html: '<div id="olps-ads-root"></div>',
        ads: {
          keywordCluster: ['Alpha KW'],
          screens: [
            { screenId: 'e1', role: 'entry', title: 'E', html: '<p>entry</p>', entryFor: ['Alpha KW'] },
            { screenId: 'cta', role: 'cta', title: 'C', html: '<p>cta</p>' },
          ],
          guide: {
            entryByKeyword: { 'Alpha KW': 'e1' },
            nodes: { e1: { options: [{ id: '1', label: 'Go', action: 'go_cta' }] }, cta: { options: [] } },
          },
        },
      },
    })
    await buildSite(workspace)
    const indexHtml = await fs.readFile(path.join(workspace, 'public', 'index.html'), 'utf8')
    const prefix = sitePathPrefix({ publicSiteUrl: 'https://example.test/s/rs-site-1' })
    expect(indexHtml).toContain(`${prefix}/campaign--alpha-kw/`)
    expect(indexHtml).not.toMatch(new RegExp(`${prefix}/campaign/"`))

    const server = await startStaticSiteServer(path.join(workspace, 'public'), 'rs-site-1')
    try {
      const res = await fetch(`${server.baseUrl}/index.html`)
      expect(res.status).toBe(200)
      const html = await res.text()
      for (const href of collectAnchorHrefs(html)) {
        if (!href.startsWith('/')) continue
        const url = new URL(href, `${server.baseUrl}/`).toString()
        const check = await fetch(url)
        expect(check.status, url).toBe(200)
      }
    } finally {
      await server.close()
    }
  })

  it('HTML 内 /assets 与 assets 引用经发布后 HTTP 字节与源文件一致', async () => {
    await writeJson(path.join(workspace, 'source', 'publish-config.json'), {
      publicSiteUrl: 'https://example.test/s/rs-site-1',
      publicApiBaseUrl: 'http://127.0.0.1:9',
      siteId: 'site-uuid-1',
    })
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    await fs.mkdir(path.join(workspace, 'assets', 'img'), { recursive: true })
    await fs.writeFile(path.join(workspace, 'assets', 'img', 'pic.bin'), pngBytes)
    await fs.mkdir(path.join(workspace, 'assets', 'js'), { recursive: true })
    await fs.writeFile(path.join(workspace, 'assets', 'js', 'app.js'), 'console.log("ok");', 'utf8')
    await writeJson(path.join(workspace, 'source', 'pages', 'home.json'), {
      pageId: 'home-1',
      kind: 'site',
      slug: 'home',
      title: 'Home',
      status: 'published',
      locale: 'en',
      seo: { title: 'Home', description: 'Home' },
      body: {
        html: `<section>
<img src="/assets/img/pic.bin" srcset="/assets/img/pic.bin 1x, assets/img/pic.bin 2x"/>
<script src="assets/js/app.js"></script>
<link rel="stylesheet" href="/assets/js/app.js"/>
</section>`,
      },
    })
    await buildSite(workspace)
    const homeHtml = await fs.readFile(path.join(workspace, 'public', 'home', 'index.html'), 'utf8')
    expect(homeHtml).toContain('/s/rs-site-1/assets/')

    const server = await startStaticSiteServer(path.join(workspace, 'public'), 'rs-site-1')
    try {
      const imgMatch = homeHtml.match(/src="([^"]+pic\.bin)"/)
      expect(imgMatch?.[1]).toBeTruthy()
      const imgUrl = new URL(imgMatch![1]!, `${server.baseUrl}/home/`).toString()
      const imgRes = await fetch(imgUrl)
      expect(imgRes.status).toBe(200)
      const body = Buffer.from(await imgRes.arrayBuffer())
      expect(body.equals(pngBytes)).toBe(true)

      const scriptMatch = homeHtml.match(/<script src="([^"]+app\.js)"/)
      const scriptUrl = new URL(scriptMatch![1]!, `${server.baseUrl}/home/`).toString()
      const scriptRes = await fetch(scriptUrl)
      expect(await scriptRes.text()).toBe('console.log("ok");')
    } finally {
      await server.close()
    }
  })

  it('public 目录 junction 时 build 失败且不写入外部目录', async () => {
    const outside = path.join(workspace, 'outside-target')
    await fs.mkdir(outside, { recursive: true })
    await fs.writeFile(path.join(outside, 'secret.txt'), 'SECRET', 'utf8')
    await writeJson(path.join(workspace, 'source', 'pages', 'home.json'), {
      pageId: 'home-1',
      kind: 'site',
      slug: 'home',
      title: 'Home',
      status: 'published',
      locale: 'en',
      seo: { title: 'Home', description: 'd' },
      body: { html: '<p>home</p>' },
    })
    const publicHome = path.join(workspace, 'public', 'home')
    await fs.mkdir(path.dirname(publicHome), { recursive: true })
    await fs.symlink(outside, publicHome, 'junction')
    await expect(buildSite(workspace)).rejects.toThrow(/符号|junction|symlink|链接/)
    expect(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('SECRET')
  })

  it('source/pages junction、install 路径 junction 均失败', async () => {
    const outside = path.join(workspace, 'outside-pages')
    await fs.mkdir(outside, { recursive: true })
    await writeJson(path.join(outside, 'x.json'), {
      pageId: 'x',
      kind: 'site',
      slug: 'x',
      title: 'X',
      status: 'published',
      locale: 'en',
      seo: { title: 'X', description: 'X' },
      body: { html: '<p>x</p>' },
    })
    const pagesDir = path.join(workspace, 'source', 'pages')
    await fs.rm(pagesDir, { recursive: true, force: true })
    await fs.symlink(outside, pagesDir, 'junction')
    await expect(buildSite(workspace)).rejects.toThrow(/符号|junction|symlink|链接/)

    await fs.rm(pagesDir, { recursive: true, force: true })
    await fs.mkdir(pagesDir, { recursive: true })
    await writeJson(path.join(workspace, 'source', 'pages', 'home.json'), {
      pageId: 'home-1',
      kind: 'site',
      slug: 'home',
      title: 'Home',
      status: 'published',
      locale: 'en',
      seo: { title: 'Home', description: 'd' },
      body: { html: '<p>h</p>' },
    })
    await buildSite(workspace)
    const toolsLink = path.join(workspace, 'tools')
    await fs.rm(toolsLink, { recursive: true, force: true })
    await fs.symlink(outside, toolsLink, 'junction')
    await expect(installSiteBuilder(workspace)).rejects.toThrow(/符号|junction|symlink|链接/)
  })

  it('重复 route 即使 pageId 相同也拒绝，含大小写与 keyword 碰撞', async () => {
    await writeJson(path.join(workspace, 'source', 'pages', 'a.json'), {
      pageId: 'p1',
      kind: 'site',
      slug: 'Home',
      title: 'H1',
      status: 'published',
      locale: 'en',
      seo: { title: 'H1', description: 'd' },
      body: { html: '<p>1</p>' },
    })
    await writeJson(path.join(workspace, 'source', 'pages', 'b.json'), {
      pageId: 'p1',
      kind: 'site',
      slug: 'home',
      title: 'H2',
      status: 'published',
      locale: 'en',
      seo: { title: 'H2', description: 'd' },
      body: { html: '<p>2</p>' },
    })
    await expect(buildSite(workspace)).rejects.toThrow(/route|slug|重复|冲突/i)

    await fs.rm(path.join(workspace, 'source', 'pages', 'b.json'))
    await writeJson(path.join(workspace, 'source', 'pages', 'ads-1.json'), {
      pageId: 'ads-1',
      kind: 'ads',
      slug: 'camp',
      title: 'C',
      status: 'published',
      locale: 'en',
      seo: { title: 'C', description: 'd' },
      body: {
        html: '<div id="olps-ads-root"></div>',
        ads: {
          keywordCluster: ['Alpha KW', 'Alpha-KW'],
          screens: [
            { screenId: 'e1', role: 'entry', title: 'E', html: '<p>e</p>', entryFor: ['Alpha KW'] },
            { screenId: 'e2', role: 'entry', title: 'E2', html: '<p>e2</p>', entryFor: ['Alpha-KW'] },
            { screenId: 'cta', role: 'cta', title: 'C', html: '<p>c</p>' },
          ],
          guide: {
            entryByKeyword: { 'Alpha KW': 'e1', 'Alpha-KW': 'e2' },
            nodes: {
              e1: { options: [{ id: '1', label: 'Go', action: 'go_cta' }] },
              e2: { options: [{ id: '2', label: 'Go', action: 'go_cta' }] },
              cta: { options: [] },
            },
          },
        },
      },
    })
    await expect(buildSite(workspace)).rejects.toThrow(/keyword|route|冲突/i)

    await fs.rm(path.join(workspace, 'source', 'pages', 'ads-1.json'))
    await writeJson(path.join(workspace, 'source', 'pages', 'assets.json'), {
      pageId: 'assets-page',
      kind: 'site',
      slug: 'assets',
      title: 'Assets page',
      status: 'published',
      locale: 'en',
      seo: { title: 'A', description: 'd' },
      body: { html: '<p>a</p>' },
    })
    await expect(buildSite(workspace)).rejects.toThrow(/assets|保留|route|slug/i)

    await fs.rm(path.join(workspace, 'source', 'pages', 'assets.json'))
    await writeJson(path.join(workspace, 'source', 'pages', 'badslug.json'), {
      pageId: 'bad',
      kind: 'site',
      slug: 'foo--bar',
      title: 'Bad',
      status: 'published',
      locale: 'en',
      seo: { title: 'B', description: 'd' },
      body: { html: '<p>b</p>' },
    })
    await expect(buildSite(workspace)).rejects.toThrow(/slug|格式/i)
  })

  it('validateGuideGraph 在 build 与 verify 拒绝无效广告结构', async () => {
    await writeJson(path.join(workspace, 'source', 'pages', 'ads-1.json'), {
      pageId: 'ads-1',
      kind: 'ads',
      slug: 'camp',
      title: 'C',
      status: 'published',
      locale: 'en',
      seo: { title: 'C', description: 'd' },
      body: {
        html: '<div id="olps-ads-root"></div>',
        ads: {
          keywordCluster: ['K1', 'K2'],
          screens: [{ screenId: 'only', role: 'content', title: 'X', html: '<p>x</p>' }],
          guide: { entryByKeyword: { K1: 'only', K2: 'only' }, nodes: { only: { options: [] } } },
        },
      },
    })
    await expect(buildSite(workspace)).rejects.toThrow(/guide|cta|校验|validation/i)
    await writeJson(path.join(workspace, 'source', 'pages', 'ads-1.json'), {
      pageId: 'ads-1',
      kind: 'ads',
      slug: 'camp',
      title: 'C',
      status: 'published',
      locale: 'en',
      seo: { title: 'C', description: 'd' },
      body: {
        html: '<div id="olps-ads-root"></div>',
        ads: {
          keywordCluster: ['K1'],
          screens: [
            { screenId: 'e1', role: 'entry', title: 'E', html: '<p>e</p>' },
            { screenId: 'cta', role: 'cta', title: 'C', html: '<p>c</p>' },
          ],
          guide: {
            entryByKeyword: { K1: 'e1' },
            nodes: { e1: { options: [{ id: '1', label: 'Go', action: 'navigate', targetScreenId: 'missing' }] }, cta: { options: [] } },
          },
        },
      },
    })
    await expect(buildSite(workspace)).rejects.toThrow(/guide|target|校验|validation/i)
    await expect(verifySite(workspace)).rejects.toThrow(/guide|target|校验|validation/i)
  })

  it('site/content 表单经 Playwright Chromium 提交至本地 HTTP 服务', async () => {
    const received: { body: unknown; pageId: string | null }[] = []
    const apiServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'content-type')
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.end()
        return
      }
      if (req.method === 'POST' && req.url?.includes('/inquiries')) {
        const u = new URL(req.url, 'http://127.0.0.1')
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        received.push({
          pageId: u.searchParams.get('pageId'),
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        })
        res.statusCode = 200
        res.end('{}')
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', () => resolve()))
    const apiPort = (apiServer.address() as { port: number }).port
    await writeJson(path.join(workspace, 'source', 'publish-config.json'), {
      publicSiteUrl: 'https://example.test/s/rs-site-1',
      publicApiBaseUrl: `http://127.0.0.1:${apiPort}`,
      siteId: 'site-uuid-1',
    })
    await writeJson(path.join(workspace, 'source', 'pages', 'contact.json'), {
      pageId: 'contact-1',
      kind: 'content',
      slug: 'contact',
      title: 'Contact',
      status: 'published',
      locale: 'en',
      seo: { title: 'Contact', description: 'd' },
      body: {
        html: `<form data-olps-inquiry>
<input name="name" value="Ada"/>
<button type="submit">Send</button>
</form>`,
      },
    })
    await buildSite(workspace)
    const staticServer = await startStaticSiteServer(path.join(workspace, 'public'), 'rs-site-1')
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.goto(`${staticServer.baseUrl}/contact/`, { waitUntil: 'load' })
      const responseWait = page.waitForResponse(
        (r) => r.url().includes('/inquiries') && r.request().method() === 'POST',
        { timeout: 15_000 },
      )
      await page.getByRole('button', { name: 'Send' }).click()
      await responseWait
      expect(received.length).toBeGreaterThan(0)
      expect(received[0]!.pageId).toBe('contact-1')
      expect(received[0]!.body).toMatchObject({ name: 'Ada' })
    } finally {
      await browser.close()
      await staticServer.close()
      apiServer.close()
    }
  }, 60_000)

  it('广告页特殊字符与 parse5 注入不破坏脚本结构', async () => {
    const tricky = `Quote " double & <tag> </script> end`
    await writeJson(path.join(workspace, 'source', 'publish-config.json'), {
      publicSiteUrl: 'https://example.test/s/rs-site-1',
      publicApiBaseUrl: 'http://127.0.0.1:9',
      siteId: 'site-uuid-1',
    })
    await writeJson(path.join(workspace, 'source', 'pages', 'ads-1.json'), {
      pageId: 'ads-1',
      kind: 'ads',
      slug: 'camp',
      title: 'C',
      status: 'published',
      locale: 'en',
      seo: { title: 'C', description: 'd' },
      body: {
        html: '<div id="olps-ads-root"></div>',
        ads: {
          keywordCluster: [tricky],
          screens: [
            {
              screenId: 'e1',
              role: 'entry',
              title: 'E',
              html: `<p>${tricky}</p>`,
              entryFor: [tricky],
            },
            { screenId: 'cta', role: 'cta', title: 'C', html: '<p>c</p>' },
          ],
          guide: {
            entryByKeyword: { [tricky]: 'e1' },
            nodes: { e1: { options: [{ id: '1', label: 'Go', action: 'go_cta' }] }, cta: { options: [] } },
          },
        },
      },
    })
    await buildSite(workspace)
    const routeSlug = `camp--${slugifyKeyword(tricky)}`
    const out = await fs.readFile(path.join(workspace, 'public', routeSlug, 'index.html'), 'utf8')
    expect(out).toContain('id="olps-ads-data"')
    expect(out).toContain('getAttribute(\'data-kw\')')
    expect(out.split('<script').length).toBeGreaterThan(2)
    const dataEl = findElementById(out, 'olps-ads-data')
    expect(dataEl).toBeTruthy()
    const jsonText = dataEl!.childNodes.find((n) => n.nodeName === '#text') as { value: string } | undefined
    expect(jsonText?.value).toBeTruthy()
    const parsed = JSON.parse(jsonText!.value)
    expect(parsed.keywordCluster[0]).toBe(tricky)
    const rootEl = findElementById(out, 'olps-ads-root')
    expect(elementAttr(rootEl!, 'data-kw')).toBe(tricky)
  })
})

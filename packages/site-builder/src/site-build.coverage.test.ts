import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as parse5 from 'parse5'
import { buildSite, installSiteBuilder } from './index.js'
import { spawn } from 'node:child_process'
import { sitePathPrefix } from './publish-urls.js'
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

  it('首页入口链接指向真实页面路由且 HTTP 可访问', async () => {
    await writeJson(path.join(workspace, 'source', 'pages', 'campaign.json'), {
      pageId: 'campaign-1',
      kind: 'content',
      slug: 'campaign',
      title: 'Campaign',
      status: 'published',
      locale: 'en',
      seo: { title: 'Campaign', description: 'Campaign' },
      body: { html: '<p>campaign</p>' },
    })
    await buildSite(workspace)
    const indexHtml = await fs.readFile(path.join(workspace, 'public', 'index.html'), 'utf8')
    const prefix = sitePathPrefix({ publicSiteUrl: 'https://example.test/s/rs-site-1' })
    expect(indexHtml).toContain(`${prefix}/campaign/`)

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

  it('重复 route 即使 pageId 相同也拒绝，含大小写碰撞', async () => {
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
})

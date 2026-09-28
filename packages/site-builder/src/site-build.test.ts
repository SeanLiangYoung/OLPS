import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  buildSite,
  installSiteBuilder,
  verifySite,
} from './index.js'

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(packageRoot, '../..')
const bundledCli = path.join(packageRoot, 'dist', 'site-build.mjs')

async function rmDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function runNode(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function adsPageJson(overrides: Record<string, unknown> = {}) {
  const keywords = ['Alpha KW', 'Beta KW']
  return {
    pageId: 'ads-1',
    kind: 'ads',
    slug: 'campaign',
    title: 'Campaign',
    status: 'published',
    locale: 'en',
    seo: { title: 'Campaign SEO', description: 'Campaign desc' },
    body: {
      html: `<!doctype html><html lang="en"><head><title>Old</title></head><body><div id="olps-ads-root"></div></body></html>`,
      ads: {
        keywordCluster: keywords,
        screens: [
          {
            screenId: 'entry-a',
            role: 'entry',
            title: 'A',
            html: '<h2>A</h2>',
            entryFor: [keywords[0]],
          },
          {
            screenId: 'entry-b',
            role: 'entry',
            title: 'B',
            html: '<h2>B</h2>',
            entryFor: [keywords[1]],
          },
          {
            screenId: 'cta',
            role: 'cta',
            title: 'CTA',
            html: `<form data-olps-inquiry><input name="name" /><button type="submit">Go</button></form>`,
          },
        ],
        guide: {
          entryByKeyword: { [keywords[0]!]: 'entry-a', [keywords[1]!]: 'entry-b' },
          nodes: {
            'entry-a': { options: [{ id: '1', label: 'CTA', action: 'go_cta' }] },
            'entry-b': { options: [{ id: '2', label: 'CTA', action: 'go_cta' }] },
            cta: { options: [] },
          },
        },
      },
    },
    ...overrides,
  }
}

async function seedWorkspace(root: string): Promise<void> {
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
    publicApiBaseUrl: 'https://api.example.test',
    siteId: 'site-uuid-1',
  })
  await writeJson(path.join(root, 'source', 'pages', 'home.json'), {
    pageId: 'home-1',
    kind: 'site',
    slug: 'home',
    title: 'Home',
    status: 'published',
    locale: 'en',
    seo: { title: 'Home SEO', description: 'Home description', canonical: 'https://example.test/s/rs-site-1/home/' },
    body: { html: '<section><h1>Welcome</h1><p>Body &amp; text</p></section>' },
  })
  await writeJson(path.join(root, 'source', 'pages', 'about.json'), {
    pageId: 'about-1',
    kind: 'content',
    slug: 'about',
    title: 'About',
    status: 'draft',
    locale: 'en',
    seo: { title: 'About SEO', description: 'About description' },
    body: {
      html: `<!doctype html><html><head><title>About old</title></head><body><main>About page</main><script>console.log("keep")</script></body></html>`,
    },
  })
  await writeJson(path.join(root, 'source', 'pages', 'ads-1.json'), adsPageJson())
  await fs.mkdir(path.join(root, 'assets', 'img'), { recursive: true })
  await fs.writeFile(path.join(root, 'assets', 'img', 'logo.txt'), 'logo-bytes', 'utf8')
  await writeJson(path.join(root, 'olps.manifest.json'), {
    schemaVersion: 1,
    buildCommand: ['node', 'legacy-build.js'],
    verifyCommand: ['node', 'legacy-build.js', '--check'],
  })
}

async function expectHomeBuiltHtml(root: string): Promise<string> {
  const homeHtml = await fs.readFile(path.join(root, 'public', 'home', 'index.html'), 'utf8')
  expect(homeHtml).toContain('<title>Home SEO</title>')
  expect(homeHtml).toContain('name="description" content="Home description"')
  expect(homeHtml).toContain('<link rel="canonical" href="https://example.test/s/rs-site-1/home/"')
  expect(homeHtml).toContain('<html lang="en"')
  expect(homeHtml).toContain('<h1>Welcome</h1>')
  return homeHtml
}

describe('site-builder', () => {
  let workspace: string

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('npm', ['run', 'build', '-w', '@olps/site-builder'], {
        cwd: repoRoot,
        shell: true,
        stdio: 'inherit',
      })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`build 失败: ${code}`))
      })
    })
    const stat = await fs.stat(bundledCli)
    if (stat.size < 4096) {
      throw new Error('dist/site-build.mjs 体积异常，需完整 esbuild 打包')
    }
  })

  beforeEach(async () => {
    workspace = path.join(
      repoRoot,
      '.intermediate',
      'site-builder-tests',
      `ws-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await seedWorkspace(workspace)
  })

  afterEach(async () => {
    await rmDir(workspace)
  })

  it('buildSite 生成 HTML、SEO、ads 关键词路由、sitemap、询盘 URL 与 assets', async () => {
    await buildSite(workspace)
    const homeHtml = await expectHomeBuiltHtml(workspace)

    const aboutHtml = await fs.readFile(path.join(workspace, 'public', 'about', 'index.html'), 'utf8')
    expect(aboutHtml).toContain('<title>About SEO</title>')
    expect(aboutHtml).toContain('About page')
    expect(aboutHtml).toContain('console.log("keep")')

    const kwPath = path.join(workspace, 'public', 'campaign--alpha-kw', 'index.html')
    const adsHtml = await fs.readFile(kwPath, 'utf8')
    expect(adsHtml).toContain('id="olps-ads-data"')
    expect(adsHtml).toContain('id="olps-ads-root"')
    expect(adsHtml).toContain('data-kw="Alpha KW"')
    expect(adsHtml).toContain('https://api.example.test/api/public/site-uuid-1/inquiries?pageId=ads-1')

    const sitemap = await fs.readFile(path.join(workspace, 'public', 'sitemap.xml'), 'utf8')
    expect(sitemap).toContain('<loc>https://example.test/s/rs-site-1/home/</loc>')
    expect(sitemap).toContain('<loc>https://example.test/s/rs-site-1/campaign--alpha-kw/</loc>')
    expect(sitemap).not.toMatch(/<lastmod>/)

    const indexHtml = await fs.readFile(path.join(workspace, 'public', 'index.html'), 'utf8')
    expect(indexHtml).toContain('/s/rs-site-1/home/')

    const asset = await fs.readFile(path.join(workspace, 'public', 'assets', 'img', 'logo.txt'), 'utf8')
    expect(asset).toBe('logo-bytes')

    await buildSite(workspace)
    const homeAgain = await fs.readFile(path.join(workspace, 'public', 'home', 'index.html'), 'utf8')
    expect(homeAgain).toBe(homeHtml)
  })

  it('修改 SEO 与删除页面会更新 public 并移除旧产物', async () => {
    await buildSite(workspace)
    await writeJson(path.join(workspace, 'source', 'pages', 'home.json'), {
      pageId: 'home-1',
      kind: 'site',
      slug: 'home',
      title: 'Home',
      status: 'published',
      locale: 'en',
      seo: { title: 'Home SEO v2', description: 'Home description v2' },
      body: { html: '<p>Updated home</p>' },
    })
    await fs.unlink(path.join(workspace, 'source', 'pages', 'about.json'))
    await buildSite(workspace)

    const homeHtml = await fs.readFile(path.join(workspace, 'public', 'home', 'index.html'), 'utf8')
    expect(homeHtml).toContain('Home SEO v2')
    expect(homeHtml).toContain('Updated home')
    await expect(fs.stat(path.join(workspace, 'public', 'about', 'index.html'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('重复 slug 与关键词路由冲突时构建失败', async () => {
    await writeJson(path.join(workspace, 'source', 'pages', 'dup.json'), {
      pageId: 'dup-1',
      kind: 'site',
      slug: 'home',
      title: 'Dup',
      status: 'published',
      locale: 'en',
      seo: { title: 'Dup', description: 'Dup' },
      body: { html: '<p>dup</p>' },
    })
    await expect(buildSite(workspace)).rejects.toThrow(/重复 route|slug/)

    await fs.unlink(path.join(workspace, 'source', 'pages', 'dup.json'))
    await writeJson(path.join(workspace, 'source', 'pages', 'ads-2.json'), adsPageJson({
      pageId: 'ads-2',
      slug: 'campaign',
      body: {
        html: '<div id="olps-ads-root"></div>',
        ads: adsPageJson().body.ads,
      },
    }))
    await expect(buildSite(workspace)).rejects.toThrow(/keyword|route|冲突|重复/)
  })

  it('存在询盘表单但缺少 publicApiBaseUrl 或 siteId 时构建失败', async () => {
    await writeJson(path.join(workspace, 'source', 'publish-config.json'), {
      publicSiteUrl: 'https://example.test/s/rs-site-1',
    })
    await expect(buildSite(workspace)).rejects.toThrow(/inquiry|publicApiBaseUrl|siteId|data-olps-inquiry/)
  })

  it('拒绝 traversal、绝对路径与符号链接 assets', async () => {
    await writeJson(path.join(workspace, 'source', 'pages', 'evil.json'), {
      pageId: 'evil-1',
      kind: 'site',
      slug: '../escape',
      title: 'Evil',
      status: 'published',
      locale: 'en',
      seo: { title: 'Evil', description: 'Evil' },
      body: { html: '<p>x</p>' },
    })
    await expect(buildSite(workspace)).rejects.toThrow()
    await fs.unlink(path.join(workspace, 'source', 'pages', 'evil.json'))

    const targetDir = path.join(workspace, 'assets', 'real-dir')
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(path.join(targetDir, 'x.txt'), 'y', 'utf8')
    const linkPath = path.join(workspace, 'assets', 'link-out')
    await fs.symlink(targetDir, linkPath, 'junction')
    await expect(buildSite(workspace)).rejects.toThrow(/symlink|junction|符号|不允许/)
  })

  it('verifySite 在产物被篡改后非零退出', async () => {
    await buildSite(workspace)
    await verifySite(workspace)

    const tampered = path.join(workspace, 'public', 'home', 'index.html')
    const raw = await fs.readFile(tampered, 'utf8')
    await fs.writeFile(tampered, `${raw}\n<!-- tampered -->\n`, 'utf8')
    await expect(verifySite(workspace)).rejects.toThrow()
  })

  it('installSiteBuilder 安装真实 CLI，manifest 正确，CLI build/verify 与 HTML 内容正确', async () => {
    const bundledBytes = await fs.readFile(bundledCli)

    await installSiteBuilder(workspace)
    const manifest = JSON.parse(await fs.readFile(path.join(workspace, 'olps.manifest.json'), 'utf8'))
    expect(manifest.buildCommand).toEqual(['node', 'tools/site-build.mjs'])
    expect(manifest.verifyCommand).toEqual(['node', 'tools/site-build.mjs', '--verify'])
    expect(manifest.schemaVersion).toBe(1)

    const installedBytes = await fs.readFile(path.join(workspace, 'tools', 'site-build.mjs'))
    expect(Buffer.compare(installedBytes, bundledBytes)).toBe(0)

    const buildRun = await runNode(['tools/site-build.mjs'], workspace)
    expect(buildRun.code).toBe(0)
    await expectHomeBuiltHtml(workspace)

    const adsHtml = await fs.readFile(
      path.join(workspace, 'public', 'campaign--alpha-kw', 'index.html'),
      'utf8',
    )
    expect(adsHtml).toContain('https://api.example.test/api/public/site-uuid-1/inquiries?pageId=ads-1')

    const verifyRun = await runNode(['tools/site-build.mjs', '--verify'], workspace)
    expect(verifyRun.code).toBe(0)

    await fs.appendFile(path.join(workspace, 'public', 'sitemap.xml'), '\n')
    const verifyFail = await runNode(['tools/site-build.mjs', '--verify'], workspace)
    expect(verifyFail.code).not.toBe(0)
  })

  it('无 node_modules 的 sandbox 经 install 后 CLI 可独立 build 与 verify', async () => {
    const sandbox = path.join(workspace, 'isolated-sandbox')
    await fs.mkdir(path.join(sandbox, 'source', 'pages'), { recursive: true })
    await fs.cp(path.join(workspace, 'source'), path.join(sandbox, 'source'), { recursive: true })
    await fs.cp(path.join(workspace, 'assets'), path.join(sandbox, 'assets'), { recursive: true })
    await fs.copyFile(
      path.join(workspace, 'olps.manifest.json'),
      path.join(sandbox, 'olps.manifest.json'),
    )

    await installSiteBuilder(sandbox)

    const buildRun = await runNode(['tools/site-build.mjs'], sandbox)
    expect(buildRun.code).toBe(0)
    await expectHomeBuiltHtml(sandbox)

    const verifyRun = await runNode(['tools/site-build.mjs', '--verify'], sandbox)
    expect(verifyRun.code).toBe(0)

    await fs.appendFile(path.join(sandbox, 'public', 'home', 'index.html'), '<!-- x -->')
    const verifyFail = await runNode(['tools/site-build.mjs', '--verify'], sandbox)
    expect(verifyFail.code).not.toBe(0)
  })
})

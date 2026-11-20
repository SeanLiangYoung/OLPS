import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadSiteModel } from '@olps/render'
import { buildSite } from './build.js'
import { runBuildChecks } from './build-checks.js'
import { processImages, type ProcessImagesOptions } from './images.js'
import { createFsSourceReader, loadWorkspace } from './load.js'

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(packageRoot, '../..')
const fullSiteFixtureRoot = path.join(
  repoRoot,
  'packages',
  'render',
  'test-fixtures',
  'sites',
  'full-site',
)
const starterThemeRoot = path.join(repoRoot, 'packages', 'builtin-themes', 'starter')
const builtinPluginsRoot = path.join(repoRoot, 'packages', 'builtin-plugins')
const builtinPluginIds = ['inquiry-form', 'whatsapp', 'google-maps'] as const

async function rmDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}

async function writeTree(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const abs = path.join(root, ...relativePath.split('/'))
    await fs.mkdir(path.dirname(abs), { recursive: true })
    if (typeof content === 'string') {
      await fs.writeFile(abs, content, 'utf8')
    } else {
      await fs.writeFile(abs, content)
    }
  }
}

async function listHtmlFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return
      }
      throw error
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        out.push(path.relative(dir, abs).replace(/\\/g, '/'))
      }
    }
  }
  await walk(dir)
  return out.sort()
}

async function materializeFullSite(workspace: string): Promise<{ mediaId: string; imageRel: string }> {
  await fs.cp(fullSiteFixtureRoot, workspace, { recursive: true })
  await fs.cp(starterThemeRoot, path.join(workspace, 'themes', 'starter'), { recursive: true })
  for (const pluginId of builtinPluginIds) {
    await fs.cp(
      path.join(builtinPluginsRoot, pluginId),
      path.join(workspace, 'plugins', pluginId),
      { recursive: true },
    )
  }

  const mediaId = '77777777-7777-4777-8777-777777777701'
  const imageRel = 'assets/uploads/2026/11/hero.png'
  const png = await sharp({
    create: {
      width: 1600,
      height: 900,
      channels: 3,
      background: { r: 20, g: 90, b: 160 },
    },
  })
    .png()
    .toBuffer()

  await writeTree(workspace, {
    [imageRel]: png,
    [`source/media/${mediaId}.json`]: `${JSON.stringify(
      {
        schemaVersion: 1,
        mediaId,
        path: imageRel,
        mimeType: 'image/png',
        size: png.byteLength,
        width: 1600,
        height: 900,
        title: { en: 'Hero', 'zh-CN': '主图' },
        alt: { en: 'Hero image', 'zh-CN': '主图' },
        caption: { en: '', 'zh-CN': '' },
        uploadedBy: '00000000-0000-4000-8000-000000000001',
        uploadedAt: '2026-11-20T00:00:00.000Z',
        updatedAt: '2026-11-20T00:00:00.000Z',
      },
      null,
      2,
    )}\n`,
  })

  const homeEnPath = path.join(
    workspace,
    'source',
    'pages',
    '11111111-1111-4111-8111-111111111101',
    'en.json',
  )
  const homeEn = JSON.parse(await fs.readFile(homeEnPath, 'utf8')) as {
    blocks: Array<{ id: string; type: string; props: Record<string, unknown>; children: unknown[] }>
  }
  homeEn.blocks.push({
    id: 'home-en-hero-image',
    type: 'core/image',
    props: {
      image: { mediaId },
      alt: 'Hero image',
    },
    children: [],
  })
  await fs.writeFile(homeEnPath, `${JSON.stringify(homeEn, null, 2)}\n`, 'utf8')

  // 第二个产品系列无子分组也无条目，渲染 ItemList 会失败；测试网站去掉该空分组
  await fs.rm(
    path.join(
      workspace,
      'source',
      'collections',
      '22222222-2222-4222-8222-222222222202',
      'groups',
      '55555555-5555-4555-8555-555555555502',
    ),
    { recursive: true, force: true },
  )

  // 新闻 / 解决方案总列表需要至少一条已发布条目，否则 ItemList 结构化数据为空会失败
  const newsId = '66666666-6666-4666-8666-666666666701'
  const solutionId = '66666666-6666-4666-8666-666666666801'
  const newsCollectionId = '22222222-2222-4222-8222-222222222201'
  const solutionsCollectionId = '22222222-2222-4222-8222-222222222203'

  for (const spec of [
    {
      collectionId: newsCollectionId,
      itemId: newsId,
      slug: { en: 'factory-update', 'zh-CN': 'gongchang-gengxin' },
      title: { en: 'Factory Update', 'zh-CN': '工厂动态' },
      fields: { publishedDate: '2026-11-20', author: 'Acme', cover: null },
    },
    {
      collectionId: solutionsCollectionId,
      itemId: solutionId,
      slug: { en: 'plant-audit', 'zh-CN': 'changqu-shenji' },
      title: { en: 'Plant Audit', 'zh-CN': '厂区审计' },
      fields: {},
    },
  ] as const) {
    await writeTree(workspace, {
      [`source/collections/${spec.collectionId}/items/${spec.itemId}/item.json`]: `${JSON.stringify(
        {
          schemaVersion: 1,
          itemId: spec.itemId,
          primaryGroupId: null,
          groupIds: [],
          order: 10,
          publishedAt: '2026-11-20T00:00:00.000Z',
          status: 'published',
          fields: spec.fields,
          createdAt: '2026-11-20T00:00:00.000Z',
          updatedAt: '2026-11-20T00:00:00.000Z',
        },
        null,
        2,
      )}\n`,
      [`source/collections/${spec.collectionId}/items/${spec.itemId}/en.json`]: `${JSON.stringify(
        {
          schemaVersion: 1,
          locale: 'en',
          slug: spec.slug.en,
          title: spec.title.en,
          summary: spec.title.en,
          cover: null,
          seo: {
            title: spec.title.en,
            description: spec.title.en,
            ogImage: null,
          },
          blocks: [
            {
              id: `${spec.itemId}-en-html`,
              type: 'core/html',
              props: { html: `<p>${spec.title.en}</p>` },
              children: [],
            },
          ],
          sourceHash: null,
          updatedAt: '2026-11-20T00:00:00.000Z',
          fields: {},
        },
        null,
        2,
      )}\n`,
      [`source/collections/${spec.collectionId}/items/${spec.itemId}/zh-CN.json`]: `${JSON.stringify(
        {
          schemaVersion: 1,
          locale: 'zh-CN',
          slug: spec.slug['zh-CN'],
          title: spec.title['zh-CN'],
          summary: spec.title['zh-CN'],
          cover: null,
          seo: {
            title: spec.title['zh-CN'],
            description: spec.title['zh-CN'],
            ogImage: null,
          },
          blocks: [
            {
              id: `${spec.itemId}-zh-html`,
              type: 'core/html',
              props: { html: `<p>${spec.title['zh-CN']}</p>` },
              children: [],
            },
          ],
          sourceHash: null,
          updatedAt: '2026-11-20T00:00:00.000Z',
          fields: {},
        },
        null,
        2,
      )}\n`,
    })
  }

  return { mediaId, imageRel }
}

describe('W4-T1 整站构建与资源处理', () => {
  let workspace: string

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        'npm',
        [
          'run',
          'build',
          '-w',
          '@olps/domain',
          '-w',
          '@olps/render',
          '-w',
          '@olps/plugin-runtime',
          '-w',
          '@olps/tracking-runtime',
          '-w',
          '@olps/builtin-themes',
          '-w',
          '@olps/builtin-plugins',
          '-w',
          '@olps/sync',
        ],
        { cwd: repoRoot, shell: true, stdio: 'inherit' },
      )
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`依赖包构建失败: ${code}`))
      })
    })
  }, 300_000)

  afterEach(async () => {
    if (workspace) {
      await rmDir(workspace)
    }
  })

  it('构建测试网站：两种语言至少 26 个 HTML，每个公开路由一个 HTML，CSS/JS 含内容哈希', async () => {
    workspace = path.join(
      repoRoot,
      '.intermediate',
      'site-builder-tests',
      `full-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await materializeFullSite(workspace)
    await buildSite(workspace)

    const htmlFiles = await listHtmlFiles(path.join(workspace, 'public'))
    expect(htmlFiles.length).toBeGreaterThanOrEqual(26)

    const locales = ['en', 'zh-CN']
    for (const locale of locales) {
      expect(htmlFiles).toContain(`${locale}/index.html`)
      expect(htmlFiles).toContain(`${locale}/about/index.html`)
      expect(htmlFiles).toContain(`${locale}/contact/index.html`)
      expect(htmlFiles).toContain(`${locale}/products/index.html`)
    }

    const unique = new Set(htmlFiles)
    expect(unique.size).toBe(htmlFiles.length)

    const themeAssets = await fs.readdir(path.join(workspace, 'public', 'assets', 'theme', 'starter'))
    expect(themeAssets.some((name) => /^style\.[a-f0-9]+\.css$/.test(name))).toBe(true)

    const pluginAssets = await fs.readdir(
      path.join(workspace, 'public', 'assets', 'plugin', 'inquiry-form'),
    )
    expect(pluginAssets.some((name) => /^form\.[a-f0-9]+\.js$/.test(name))).toBe(true)

    const homeHtml = await fs.readFile(path.join(workspace, 'public', 'en', 'index.html'), 'utf8')
    expect(homeHtml).toMatch(/style\.[a-f0-9]+\.css/)
    expect(homeHtml).toContain('Hero image')
    expect(homeHtml).toContain('assets/uploads/2026/11/hero.png')

    await fs.access(path.join(workspace, 'public', 'assets', 'uploads', '2026', '11', 'hero-480w.png'))
    await fs.access(path.join(workspace, 'public', 'assets', 'uploads', '2026', '11', 'hero-480w.webp'))
    await fs.access(path.join(workspace, 'public', 'assets', 'uploads', '2026', '11', 'hero.webp'))
  })

  it('同一图片第二次构建命中缓存且 sharp 调用数为 0', async () => {
    workspace = path.join(
      repoRoot,
      '.intermediate',
      'site-builder-tests',
      `img-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await materializeFullSite(workspace)
    const reader = createFsSourceReader(workspace)
    const model = await loadSiteModel(reader)

    let sharpCalls = 0
    const countingSharp: ProcessImagesOptions['sharpImpl'] = ((input?: sharp.SharpOptions | Buffer) => {
      sharpCalls += 1
      return sharp(input as Buffer)
    }) as ProcessImagesOptions['sharpImpl']

    const first = await processImages(workspace, model.media, { sharpImpl: countingSharp })
    expect(first.outputs.length).toBeGreaterThan(0)
    expect(sharpCalls).toBeGreaterThan(0)

    const callsAfterFirst = sharpCalls
    sharpCalls = 0
    const second = await processImages(workspace, model.media, { sharpImpl: countingSharp })
    expect(sharpCalls).toBe(0)
    expect(second.outputs.map((item) => item.relativePath).sort()).toEqual(
      first.outputs.map((item) => item.relativePath).sort(),
    )
    expect(callsAfterFirst).toBeGreaterThan(0)
  })

  it('build-checks 在缺少必备页面区块时失败', async () => {
    workspace = path.join(
      repoRoot,
      '.intermediate',
      'site-builder-tests',
      `checks-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await materializeFullSite(workspace)
    const aboutEn = path.join(
      workspace,
      'source',
      'pages',
      '11111111-1111-4111-8111-111111111102',
      'en.json',
    )
    const doc = JSON.parse(await fs.readFile(aboutEn, 'utf8')) as { blocks: unknown[] }
    doc.blocks = []
    await fs.writeFile(aboutEn, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')

    const loaded = await loadWorkspace(workspace)
    await expect(runBuildChecks(loaded)).rejects.toThrow(/必备页面|区块/)
  })

  it('插件 onBuild 与 transformHtml 会写入文件并修改 HTML', async () => {
    workspace = path.join(
      repoRoot,
      '.intermediate',
      'site-builder-tests',
      `plugin-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await materializeFullSite(workspace)

    const pluginId = 'hook-demo'
    await writeTree(workspace, {
      [`plugins/${pluginId}/plugin.json`]: `${JSON.stringify(
        {
          schemaVersion: 1,
          id: pluginId,
          name: 'Hook Demo',
          version: '1.0.0',
          author: 'OLPS',
          description: 'build hook demo',
          requires: '1',
          settings: [],
          snippets: [],
          assets: [],
          server: {
            build: 'server/build.js',
          },
          permissions: {},
        },
        null,
        2,
      )}\n`,
      [`plugins/${pluginId}/server/build.js`]: `
exports.onBuild = async function onBuild(ctx) {
  return [{ path: 'public/plugins/${pluginId}/marker.txt', content: 'from-onBuild' }];
};
exports.transformHtml = async function transformHtml(html, pageInfo, ctx) {
  return html.replace('</body>', '<!-- hook-demo -->\\n</body>');
};
`,
    })

    const pluginsConfigPath = path.join(workspace, 'source', 'plugins.json')
    const pluginsConfig = JSON.parse(await fs.readFile(pluginsConfigPath, 'utf8')) as {
      plugins: Record<
        string,
        {
          enabled: boolean
          permissionsAcceptedAt: string | null
          permissionsAcceptedBy: string | null
          settings: Record<string, unknown>
        }
      >
    }
    pluginsConfig.plugins[pluginId] = {
      enabled: true,
      permissionsAcceptedAt: null,
      permissionsAcceptedBy: null,
      settings: {},
    }
    await fs.writeFile(pluginsConfigPath, `${JSON.stringify(pluginsConfig, null, 2)}\n`, 'utf8')

    await buildSite(workspace)

    const marker = await fs.readFile(
      path.join(workspace, 'public', 'plugins', pluginId, 'marker.txt'),
      'utf8',
    )
    expect(marker).toBe('from-onBuild')

    const homeHtml = await fs.readFile(path.join(workspace, 'public', 'en', 'index.html'), 'utf8')
    expect(homeHtml).toContain('<!-- hook-demo -->')
  })
})

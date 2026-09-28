import fs from 'node:fs/promises'
import path from 'node:path'
import { defaultSiteSettings } from '@olps/domain'
import { spawn } from 'node:child_process'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  buildSite,
  computeBuildPlan,
  type LoadedWorkspace,
  type PublishConfig,
  type StoredPageJson,
} from '@olps/site-builder'

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.resolve(packageRoot, '../..')

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readWorkspaceTree(root: string, subdir: string): Promise<Map<string, string>> {
  const base = path.join(root, subdir)
  const out = new Map<string, string>()
  async function walk(relDir: string): Promise<void> {
    let names: string[] = []
    try {
      names = await fs.readdir(relDir)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return
      }
      throw err
    }
    for (const name of names) {
      const abs = path.join(relDir, name)
      const st = await fs.stat(abs)
      const rel = path.relative(base, abs).split(path.sep).join('/')
      if (st.isDirectory()) {
        await walk(abs)
      } else {
        out.set(rel, await fs.readFile(abs, 'utf8'))
      }
    }
  }
  await walk(base)
  return out
}

async function loadWorkspaceFromDisk(workspacePath: string): Promise<LoadedWorkspace> {
  const settingsRaw = JSON.parse(
    await fs.readFile(path.join(workspacePath, 'source', 'site-settings.json'), 'utf8'),
  ) as Partial<LoadedWorkspace['settings']>
  const settings = { ...defaultSiteSettings(), ...settingsRaw }
  const publishConfig = JSON.parse(
    await fs.readFile(path.join(workspacePath, 'source', 'publish-config.json'), 'utf8'),
  ) as PublishConfig
  const pagesDir = path.join(workspacePath, 'source', 'pages')
  const names = (await fs.readdir(pagesDir)).filter((n) => n.endsWith('.json')).sort()
  const pages: StoredPageJson[] = []
  for (const name of names) {
    pages.push(JSON.parse(await fs.readFile(path.join(pagesDir, name), 'utf8')) as StoredPageJson)
  }
  return { settings, publishConfig, pages }
}

function adsPageJson(): StoredPageJson {
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
            entryFor: [keywords[0]!],
          },
          {
            screenId: 'entry-b',
            role: 'entry',
            title: 'B',
            html: '<h2>B</h2>',
            entryFor: [keywords[1]!],
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
  }
}

async function seedPreviewWorkspace(root: string): Promise<void> {
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
    seo: { title: 'Home SEO', description: 'Home description' },
    body: { html: '<section><h1>Welcome</h1></section>' },
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
      html: `<main><h1>About draft</h1><p>Preview body</p></main>`,
    },
  })
  await writeJson(path.join(root, 'source', 'pages', 'ads-1.json'), adsPageJson())
}

describe('公开预览 computeBuildPlan', () => {
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
    workspace = path.join(repoRoot, '.intermediate', 'site-builder-preview', `${Date.now()}-${Math.random()}`)
    await fs.mkdir(workspace, { recursive: true })
    await seedPreviewWorkspace(workspace)
  })

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('computeBuildPlan 与 buildSite 的 content/ads HTML 一致且不改动 source/public', async () => {
    await buildSite(workspace)
    const loaded = await loadWorkspaceFromDisk(workspace)
    const sourceBefore = await readWorkspaceTree(workspace, 'source')
    const publicBefore = await readWorkspaceTree(workspace, 'public')

    const plan = computeBuildPlan(loaded)
    const byPath = new Map(plan.map((f) => [f.relativePath, f.content]))

    const sourceAfter = await readWorkspaceTree(workspace, 'source')
    const publicAfter = await readWorkspaceTree(workspace, 'public')
    expect(sourceAfter).toEqual(sourceBefore)
    expect(publicAfter).toEqual(publicBefore)

    const contentPath = 'about/index.html'
    expect(byPath.get(contentPath)).toBe(publicBefore.get(contentPath))

    for (const adsRoute of ['campaign--alpha-kw/index.html', 'campaign--beta-kw/index.html']) {
      expect(byPath.get(adsRoute)).toBe(publicBefore.get(adsRoute))
    }

    expect(byPath.get('index.html')).toBe(publicBefore.get('index.html'))
    expect(byPath.get('sitemap.xml')).toBe(publicBefore.get('sitemap.xml'))
  })
})

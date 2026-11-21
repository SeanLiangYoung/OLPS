import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { buildPreview } from './preview.js'
import { buildSite } from './build.js'
import { verifySite } from './verify.js'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
let workspace: string | undefined

afterEach(async () => {
  if (workspace) await fs.rm(workspace, { recursive: true, force: true })
})

it('草稿整站预览包含草稿页面，公开构建排除草稿，预览不含追踪文件', async () => {
  const parent = path.join(repoRoot, '.intermediate', 'preview-build-tests')
  await fs.mkdir(parent, { recursive: true })
  workspace = await fs.mkdtemp(path.join(parent, 'site-'))
  await fs.cp(path.join(repoRoot, 'packages/render/test-fixtures/sites/full-site'), workspace, { recursive: true })
  await fs.cp(path.join(repoRoot, 'packages/builtin-themes/starter'), path.join(workspace, 'themes/starter'), { recursive: true })
  for (const plugin of ['inquiry-form', 'whatsapp', 'google-maps']) {
    await fs.cp(path.join(repoRoot, 'packages/builtin-plugins', plugin), path.join(workspace, 'plugins', plugin), { recursive: true })
  }
  const source = path.join(workspace, 'source/pages/11111111-1111-4111-8111-111111111102')
  const draft = path.join(workspace, 'source/pages/11111111-1111-4111-8111-111111111199')
  await fs.cp(source, draft, { recursive: true })
  const meta = JSON.parse(await fs.readFile(path.join(draft, 'page.json'), 'utf8'))
  meta.status = 'draft'
  meta.role = null
  meta.pageId = '11111111-1111-4111-8111-111111111199'
  await fs.writeFile(path.join(draft, 'page.json'), JSON.stringify(meta))
  for (const locale of ['en', 'zh-CN']) {
    const documentPath = path.join(draft, `${locale}.json`)
    const document = JSON.parse(await fs.readFile(documentPath, 'utf8'))
    document.slug = 'draft-page'
    await fs.writeFile(documentPath, JSON.stringify(document))
  }
  await buildPreview(workspace)
  const html = await fs.readFile(path.join(workspace, 'public/en/draft-page/index.html'), 'utf8')
  expect(html).toContain('noindex')
  expect(html).not.toContain('olps-tracking')
  expect(html).not.toContain('connectors')
  await expect(fs.access(path.join(workspace, 'public/olps-tracking.js'))).rejects.toMatchObject({ code: 'ENOENT' })
  await buildSite(workspace)
  await verifySite(workspace)
  await expect(fs.access(path.join(workspace, 'public/en/draft-page/index.html'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('同一份预览产物从根目录和子目录提供时站内链接与资源均可访问', async () => {
  const parent = path.join(repoRoot, '.intermediate', 'preview-build-tests')
  await fs.mkdir(parent, { recursive: true })
  workspace = await fs.mkdtemp(path.join(parent, 'portable-'))
  await fs.cp(path.join(repoRoot, 'packages/render/test-fixtures/sites/full-site'), workspace, { recursive: true })
  await fs.cp(path.join(repoRoot, 'packages/builtin-themes/starter'), path.join(workspace, 'themes/starter'), { recursive: true })
  for (const plugin of ['inquiry-form', 'whatsapp', 'google-maps']) {
    await fs.cp(path.join(repoRoot, 'packages/builtin-plugins', plugin), path.join(workspace, 'plugins', plugin), { recursive: true })
  }
  await buildPreview(workspace)
  const publicRoot = path.join(workspace, 'public')
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url!, 'http://local.invalid').pathname).replace(/^\/subsite(?=\/)/, '')
    const target = path.resolve(publicRoot, `.${pathname}`, pathname.endsWith('/') ? 'index.html' : '')
    if (!target.startsWith(publicRoot + path.sep)) { response.writeHead(403).end(); return }
    try {
      const bytes = await fs.readFile(target)
      response.setHeader('Content-Type', target.endsWith('.html') ? 'text/html' : target.endsWith('.css') ? 'text/css' : 'application/octet-stream')
      response.end(bytes)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      response.writeHead(404).end()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const browser = await chromium.launch({ headless: true })
  try {
    for (const prefix of ['', '/subsite']) {
      const page = await browser.newPage()
      const origin = `http://127.0.0.1:${port}`
      const visited = new Set<string>()
      const queue = [`${origin}${prefix}/en/`, `${origin}${prefix}/zh-CN/`]
      while (queue.length) {
        const url = queue.shift()!
        if (visited.has(url)) continue
        visited.add(url)
        expect((await page.goto(url))!.status(), url).toBe(200)
        const links = await page.locator('a[href],img[src],link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => {
          if (element instanceof HTMLAnchorElement) return { url: element.href, document: true }
          if (element instanceof HTMLImageElement) return { url: element.src, document: false }
          return { url: (element as HTMLLinkElement).href, document: false }
        }))
        for (const link of links) {
          const target = new URL(link.url)
          target.hash = ''
          if (target.origin !== origin) continue
          expect(target.pathname.startsWith(`${prefix}/`), target.href).toBe(true)
          expect((await page.request.get(target.href)).status(), target.href).toBe(200)
          if (link.document && target.pathname.endsWith('/')) queue.push(target.href)
        }
      }
      expect(visited.size).toBeGreaterThan(10)
      await page.close()
    }
  } finally {
    await browser.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}, 120_000)

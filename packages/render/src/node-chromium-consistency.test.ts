import { describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createMemorySourceReader } from './memory-source-reader.js'
import { normalizeHtml } from './normalize-html.js'
import { renderTarget } from './render-document.js'
import { loadSiteModel } from './site-model.js'
import { PAGE_IDS } from './test-support/fixture-ids.js'
import fullSiteFiles from './test-support/full-site-files.json'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, '..')

async function ensureBrowserBundle(): Promise<string> {
  const bundlePath = path.join(packageRoot, 'test-fixtures', 'browser-render.bundle.mjs')
  execFileSync(process.execPath, [path.join(packageRoot, 'scripts', 'build-browser-bundle.mjs')], {
    cwd: packageRoot,
    stdio: 'pipe',
  })
  return bundlePath
}

describe('Node 与 Chromium 一致性', () => {
  it('同一 fixture 规范化 HTML 差异为 0', async () => {
    const reader = createMemorySourceReader(fullSiteFiles)
    const model = await loadSiteModel(reader)
    const nodeHtml = await renderTarget(
      model,
      { kind: 'page', pageId: PAGE_IDS.about },
      'en',
      { mode: 'publish', reader },
    )
    const nodeNormalized = normalizeHtml(nodeHtml)

    const bundlePath = await ensureBrowserBundle()
    const bundleCode = await fs.readFile(bundlePath, 'utf8')
    const harnessHtml = `<!DOCTYPE html><html><body><script type="module" src="/browser-render.bundle.mjs"></script></body></html>`

    const server = createServer(async (request, response) => {
      const url = request.url ?? '/'
      if (url === '/' || url.startsWith('/index')) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(harnessHtml)
        return
      }
      if (url === '/browser-render.bundle.mjs') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        response.end(bundleCode)
        return
      }
      response.writeHead(404)
      response.end('not found')
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('无法取得测试服务器地址')
    }

    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.goto(`http://127.0.0.1:${address.port}/`)
      const chromiumNormalized = await page.evaluate(async ({ files, pageId }) => {
        const dynamicImport = new Function(
          'specifier',
          'return import(specifier)',
        ) as (specifier: string) => Promise<{
          createMemorySourceReader: (files: Record<string, string>) => unknown
          loadSiteModel: (reader: unknown) => Promise<unknown>
          renderTarget: (
            model: unknown,
            target: { kind: string; pageId: string },
            locale: string,
            options: { mode: string; reader: unknown },
          ) => Promise<string>
          normalizeHtml: (html: string) => string
        }>
        const render = await dynamicImport('/browser-render.bundle.mjs')
        const memoryReader = render.createMemorySourceReader(files)
        const siteModel = await render.loadSiteModel(memoryReader)
        const html = await render.renderTarget(
          siteModel,
          { kind: 'page', pageId },
          'en',
          { mode: 'publish', reader: memoryReader },
        )
        return render.normalizeHtml(html)
      }, {
        files: fullSiteFiles,
        pageId: PAGE_IDS.about,
      })

      expect(chromiumNormalized).toBe(nodeNormalized)
    } finally {
      await browser.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  })
})

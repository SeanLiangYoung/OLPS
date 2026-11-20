import { createServer, type Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import { HtmlValidate } from 'html-validate'
import { chromium } from 'playwright'
import {
  BlockRenderError,
  createMemorySourceReader,
  I18nLookupError,
  loadSiteModel,
  renderTarget,
  type SiteModel,
  type SourceReader,
} from '@olps/render'
import { builtinPluginIds } from './paths.js'
import { buildBuiltinSiteFiles } from './site-files.js'

const CONTACT_PAGE_ID = '11111111-1111-4111-8111-111111111103'
const HOME_PAGE_ID = '11111111-1111-4111-8111-111111111101'
const NOT_FOUND_PAGE_ID = '11111111-1111-4111-8111-111111111108'
const PRODUCTS_COLLECTION_ID = '22222222-2222-4222-8222-222222222202'
const GROUP_ID = '55555555-5555-4555-8555-555555555503'
const ITEM_ID = '66666666-6666-4666-8666-666666666601'

const htmlValidate = new HtmlValidate({
  extends: ['html-validate:recommended'],
  rules: {
    'no-inline-style': 'off',
    'require-sri': 'off',
    'no-trailing-whitespace': 'off',
  },
})

type RenderCounts = {
  unknownBlocks: number
  missingTranslations: number
  missingTemplates: number
}

async function loadBuiltinSite(
  disabledPluginIds: string[] = [],
): Promise<{ reader: SourceReader; model: SiteModel }> {
  const files = await buildBuiltinSiteFiles({ disabledPluginIds })
  const reader = createMemorySourceReader(files)
  const model = await loadSiteModel(reader)
  return { reader, model }
}

async function countRenderFailures(
  model: SiteModel,
  reader: SourceReader,
  targets: Array<Parameters<typeof renderTarget>[1]>,
): Promise<RenderCounts> {
  const counts: RenderCounts = {
    unknownBlocks: 0,
    missingTranslations: 0,
    missingTemplates: 0,
  }

  for (const target of targets) {
    for (const locale of ['en', 'zh-CN'] as const) {
      try {
        await renderTarget(model, target, locale, { mode: 'publish', reader })
      } catch (error) {
        if (error instanceof BlockRenderError && /未知区块类型/.test(error.message)) {
          counts.unknownBlocks += 1
          continue
        }
        if (
          error instanceof I18nLookupError
          || (error instanceof Error && /缺少翻译键/.test(error.message))
        ) {
          counts.missingTranslations += 1
          continue
        }
        if (error instanceof Error && /缺少必需模板/.test(error.message)) {
          counts.missingTemplates += 1
          continue
        }
        throw error
      }
    }
  }

  return counts
}

const coverageTargets: Array<Parameters<typeof renderTarget>[1]> = [
  { kind: 'page', pageId: HOME_PAGE_ID },
  { kind: 'page', pageId: CONTACT_PAGE_ID },
  { kind: 'page', pageId: NOT_FOUND_PAGE_ID },
  { kind: 'collection', collectionId: PRODUCTS_COLLECTION_ID },
  { kind: 'group', collectionId: PRODUCTS_COLLECTION_ID, groupId: GROUP_ID },
  { kind: 'item', collectionId: PRODUCTS_COLLECTION_ID, itemId: ITEM_ID },
]

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('无法取得测试服务器地址')
  }
  return address.port
}

describe('内置主题与插件渲染验收', () => {
  it('启用全部内置包后：未知区块、缺翻译键、缺模板均为 0', async () => {
    const { model, reader } = await loadBuiltinSite()
    const counts = await countRenderFailures(model, reader, coverageTargets)
    expect(counts).toEqual({
      unknownBlocks: 0,
      missingTranslations: 0,
      missingTemplates: 0,
    })

    for (const sectionName of [
      'hero',
      'feature-grid',
      'spec-table',
      'pricing',
      'case-studies',
      'cta',
      'stats',
      'logo-wall',
      'gallery',
      'contact-info',
    ]) {
      const registry = await import('@olps/render').then((mod) =>
        mod.loadBlockRegistry(reader, {
          themeId: 'starter',
          enabledPluginIds: [...builtinPluginIds],
        }),
      )
      expect(registry.has(`theme/${sectionName}`)).toBe(true)
    }

    const contactHtml = await renderTarget(
      model,
      { kind: 'page', pageId: CONTACT_PAGE_ID },
      'en',
      { mode: 'publish', reader },
    )
    expect(contactHtml).toContain('data-olps-plugin="inquiry-form"')
    expect(contactHtml).toContain('data-olps-plugin="google-maps"')
    expect(contactHtml).toContain('data-olps-plugin="whatsapp"')
  })

  for (const pluginId of builtinPluginIds) {
    it(`${pluginId} 启用时可渲染，停用后 contact 出现未知区块`, async () => {
      const enabled = await loadBuiltinSite()
      await expect(
        renderTarget(
          enabled.model,
          { kind: 'page', pageId: CONTACT_PAGE_ID },
          'en',
          { mode: 'publish', reader: enabled.reader },
        ),
      ).resolves.toContain(`data-olps-plugin="${pluginId}"`)

      const disabled = await loadBuiltinSite([pluginId])
      await expect(
        renderTarget(
          disabled.model,
          { kind: 'page', pageId: CONTACT_PAGE_ID },
          'en',
          { mode: 'publish', reader: disabled.reader },
        ),
      ).rejects.toBeInstanceOf(BlockRenderError)
    })
  }

  it('渲染 HTML 通过 html-validate', async () => {
    const { model, reader } = await loadBuiltinSite()
    const html = await renderTarget(
      model,
      { kind: 'page', pageId: CONTACT_PAGE_ID },
      'en',
      { mode: 'publish', reader },
    )
    const report = await htmlValidate.validateString(html)
    expect(report.valid, JSON.stringify(report.results, null, 2)).toBe(true)
  })

  it('Playwright 在 375/768/1280 宽度无横向滚动，按钮与表单可点击', async () => {
    const { model, reader } = await loadBuiltinSite()
    const html = await renderTarget(
      model,
      { kind: 'page', pageId: CONTACT_PAGE_ID },
      'en',
      { mode: 'publish', reader },
    )

    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(html)
      void request
    })
    const port = await listen(server)
    const browser = await chromium.launch({ headless: true })

    try {
      for (const width of [375, 768, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } })
        await page.goto(`http://127.0.0.1:${port}/`)
        const metrics = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)

        const form = page.locator('form[data-olps-inquiry-form]')
        expect(await form.isVisible()).toBe(true)
        await form.locator('button[type="submit"]').click({ trial: true })

        const whatsapp = page.locator('a[data-olps-whatsapp-button]')
        expect(await whatsapp.isVisible()).toBe(true)
        await whatsapp.click({ trial: true })
        await page.close()
      }
    } finally {
      await browser.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})

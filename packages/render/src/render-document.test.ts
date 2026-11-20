import { describe, expect, it } from 'vitest'
import {
  GROUP_IDS,
  ITEM_IDS,
  PAGE_IDS,
  PRODUCTS_COLLECTION_ID,
} from './test-support/fixture-ids.js'
import { loadFullSite } from './test-support/load-full-site.js'
import { renderTarget, resolveTemplatePath } from './render-document.js'
import { normalizeHtml } from './normalize-html.js'

describe('render-document', () => {
  it('模板查找：page-<role> 优先于 page.liquid', async () => {
    const { reader } = await loadFullSite()
    const homeTemplate = await resolveTemplatePath(reader, {
      themeId: 'starter',
      kind: 'page',
      role: 'home',
      template: 'page',
      collectionId: null,
    })
    expect(homeTemplate).toBe('themes/starter/templates/page-home.liquid')

    const aboutTemplate = await resolveTemplatePath(reader, {
      themeId: 'starter',
      kind: 'page',
      role: 'about',
      template: 'page',
      collectionId: null,
    })
    expect(aboutTemplate).toBe('themes/starter/templates/page.liquid')
  })

  it('缺少四个必需模板时抛出错误', async () => {
    const { reader } = await loadFullSite()
    const brokenReader = {
      async readText(path: string): Promise<string> {
        if (path.endsWith('page.liquid')) {
          const error = new Error('missing') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          throw error
        }
        return reader.readText(path)
      },
      async list(path: string): Promise<string[]> {
        return reader.list(path)
      },
    }

    await expect(
      resolveTemplatePath(brokenReader, {
        themeId: 'starter',
        kind: 'page',
        role: null,
        template: 'page',
        collectionId: null,
      }),
    ).rejects.toThrow(/page\.liquid/)
  })

  it('页面、列表、分组、条目在三种模式可渲染', async () => {
    const { model, reader } = await loadFullSite()
    const modes = ['publish', 'preview', 'canvas'] as const
    const targets = [
      { kind: 'page' as const, pageId: PAGE_IDS.home },
      { kind: 'collection' as const, collectionId: PRODUCTS_COLLECTION_ID },
      { kind: 'group' as const, collectionId: PRODUCTS_COLLECTION_ID, groupId: GROUP_IDS.catAlpha1 },
      { kind: 'item' as const, collectionId: PRODUCTS_COLLECTION_ID, itemId: ITEM_IDS.pumpA },
    ]

    for (const mode of modes) {
      for (const target of targets) {
        const html = await renderTarget(model, target, 'en', { mode, reader })
        expect(html).toContain('<!DOCTYPE html>')
        expect(html).toContain('rel="canonical"')
        expect(html).toContain('application/ld+json')
        if (mode === 'canvas') {
          expect(html).toContain('data-olps-block=')
          expect(html).not.toContain('olps-tracking')
        } else if (mode === 'publish') {
          expect(html).not.toMatch(/data-olps-block=/)
        }
      }
    }
  })

  it('publish 模式输出 hreflang 与条目导航', async () => {
    const { model, reader } = await loadFullSite()
    const about = await renderTarget(
      model,
      { kind: 'page', pageId: PAGE_IDS.about },
      'en',
      { mode: 'publish', reader },
    )
    expect(about).toContain('hreflang="zh-CN"')
    expect(about).toContain('hreflang="x-default"')
    expect(about).toContain('og:title')
    expect(about).toContain('FAQPage')

    const item = await renderTarget(
      model,
      { kind: 'item', collectionId: PRODUCTS_COLLECTION_ID, itemId: ITEM_IDS.pumpA },
      'en',
      { mode: 'publish', reader },
    )
    expect(item).toContain('data-olps-next')
    expect(item).toContain('Pump B')
    expect(item).toContain('BreadcrumbList')
    expect(item).toContain('"@type":"Product"')
  })

  it('thank-you 页含 noindex', async () => {
    const { model, reader } = await loadFullSite()
    const html = await renderTarget(
      model,
      { kind: 'page', pageId: PAGE_IDS.thankYou },
      'en',
      { mode: 'publish', reader },
    )
    expect(html).toMatch(/robots[^>]*noindex/i)
  })

  it('Node 规范化 HTML 稳定', async () => {
    const { model, reader } = await loadFullSite()
    const html = await renderTarget(
      model,
      { kind: 'page', pageId: PAGE_IDS.about },
      'en',
      { mode: 'publish', reader },
    )
    const once = normalizeHtml(html)
    const twice = normalizeHtml(html)
    expect(once).toBe(twice)
    expect(once.length).toBeGreaterThan(100)
  })
})

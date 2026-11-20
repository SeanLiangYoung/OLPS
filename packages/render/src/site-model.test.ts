import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSiteModel } from './site-model.js'
import {
  GROUP_IDS,
  ITEM_IDS,
  PAGE_IDS,
  PRODUCTS_COLLECTION_ID,
} from './test-support/fixture-ids.js'
import { createNodeSourceReader } from './test-support/node-source-reader.js'
import { fullSiteFixtureRoot } from './test-support/paths.js'

describe('SiteModel', () => {
  it('从完整 fixture 读取设置、页面、两层内容类型、分组与条目', async () => {
    const reader = createNodeSourceReader(fullSiteFixtureRoot)
    const model = await loadSiteModel(reader)

    expect(model.settings.defaultLocale).toBe('en')
    expect(model.settings.locales.map((locale) => locale.code)).toEqual(['en', 'zh-CN'])
    expect(model.appearance.themeId).toBe('starter')
    expect(model.plugins.plugins.whatsapp?.enabled).toBe(true)
    expect(model.pages).toHaveLength(8)
    expect(model.pages.map((page) => page.meta.role).sort()).toEqual([
      'about',
      'contact',
      'cookies',
      'home',
      'not-found',
      'privacy',
      'terms',
      'thank-you',
    ].sort())

    const home = model.pages.find((page) => page.meta.pageId === PAGE_IDS.home)
    expect(home?.locales.en?.slug).toBe('')
    expect(home?.locales['zh-CN']?.title).toBeTruthy()

    const products = model.collections.find(
      (collection) => collection.definition.collectionId === PRODUCTS_COLLECTION_ID,
    )
    expect(products).toBeDefined()
    expect(products!.definition.levels).toHaveLength(2)
    expect(products!.definition.prefix).toBe('products')
    expect(Object.keys(products!.indexLocales).sort()).toEqual(['en', 'zh-CN'])
    expect(products!.groups).toHaveLength(4)
    expect(products!.groups.map((group) => group.meta.groupId).sort()).toEqual(
      Object.values(GROUP_IDS).slice().sort(),
    )
    expect(products!.items).toHaveLength(2)

    const pumpA = products!.items.find((item) => item.meta.itemId === ITEM_IDS.pumpA)
    expect(pumpA?.meta.groupIds.sort()).toEqual(
      [GROUP_IDS.catAlpha1, GROUP_IDS.catAlpha2].sort(),
    )
    expect(pumpA?.meta.primaryGroupId).toBe(GROUP_IDS.catAlpha1)
    expect(pumpA?.locales.en?.slug).toBe('pump-a')

    expect(model.i18n.en?.strings['theme:starter:read_more']).toBe('Read more')
    expect(model.redirects.redirects).toEqual([])
  })

  it('校验失败时错误信息包含相对文件路径', async () => {
    const reader = createNodeSourceReader(fullSiteFixtureRoot)
    const broken = {
      async readText(relativePath: string): Promise<string> {
        if (relativePath === 'source/site-settings.json') {
          return JSON.stringify({ schemaVersion: 1 })
        }
        return reader.readText(relativePath)
      },
      list: reader.list.bind(reader),
    }

    await expect(loadSiteModel(broken)).rejects.toThrow(/source\/site-settings\.json/)
  })

  it('fixture 路径遵循 sandbox 目录约定', () => {
    expect(path.basename(path.dirname(fullSiteFixtureRoot))).toBe('sites')
    expect(path.basename(fullSiteFixtureRoot)).toBe('full-site')
  })
})

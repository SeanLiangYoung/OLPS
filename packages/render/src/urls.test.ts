import { describe, expect, it } from 'vitest'
import { loadSiteModel, type SiteModel } from './site-model.js'
import {
  assertNoUrlConflicts,
  collectionIndexUrl,
  groupUrl,
  homeUrl,
  itemUrl,
  notFoundUrl,
  pageUrl,
  paginationUrl,
  relativeUrl,
  UrlConflictError,
} from './urls.js'
import {
  GROUP_IDS,
  ITEM_IDS,
  PAGE_IDS,
  PRODUCTS_COLLECTION_ID,
} from './test-support/fixture-ids.js'
import { createNodeSourceReader } from './test-support/node-source-reader.js'
import { fullSiteFixtureRoot } from './test-support/paths.js'

async function loadFullSite(): Promise<SiteModel> {
  return loadSiteModel(createNodeSourceReader(fullSiteFixtureRoot))
}

describe('公开地址', () => {
  it('覆盖页面、首页、404、总列表、两层分组、条目与分页共 7 类', async () => {
    const model = await loadFullSite()
    const about = model.pages.find((page) => page.meta.pageId === PAGE_IDS.about)!
    const products = model.collections.find(
      (collection) => collection.definition.collectionId === PRODUCTS_COLLECTION_ID,
    )!
    const seriesAlpha = products.groups.find(
      (group) => group.meta.groupId === GROUP_IDS.seriesAlpha,
    )!
    const catAlpha1 = products.groups.find(
      (group) => group.meta.groupId === GROUP_IDS.catAlpha1,
    )!
    const pumpA = products.items.find((item) => item.meta.itemId === ITEM_IDS.pumpA)!

    expect(homeUrl('en')).toBe('/en/')
    expect(pageUrl('en', about.locales.en!.slug)).toBe('/en/about/')
    expect(notFoundUrl('en')).toBe('/en/404.html')
    expect(collectionIndexUrl('en', products.definition.prefix)).toBe('/en/products/')
    expect(groupUrl('en', products.definition.prefix, [
      seriesAlpha.locales.en!.slug,
      catAlpha1.locales.en!.slug,
    ])).toBe('/en/products/series-alpha/cat-alpha-1/')
    expect(itemUrl('en', products.definition.prefix, pumpA.locales.en!.slug)).toBe(
      '/en/products/pump-a/',
    )
    expect(paginationUrl('/en/products/', 2)).toBe('/en/products/page/2/')
    expect(paginationUrl('/en/products/series-alpha/', 3)).toBe(
      '/en/products/series-alpha/page/3/',
    )
  })

  it('任意两地址可计算相对路径', () => {
    expect(relativeUrl('/en/about/', '/en/products/series-alpha/')).toBe(
      '../products/series-alpha/',
    )
    expect(relativeUrl('/en/', '/en/about/')).toBe('about/')
    expect(relativeUrl('/en/products/series-alpha/cat-alpha-1/', '/en/')).toBe('../../../')
    expect(relativeUrl('/en/404.html', '/en/contact/')).toBe('contact/')
    expect(relativeUrl('/en/about/', '/zh-CN/')).toBe('../../zh-CN/')
  })
})

describe('地址冲突与保留字', () => {
  it('条目与第一层分组 slug 重复时抛出含路径的错误', async () => {
    const model = await loadFullSite()
    const products = model.collections.find(
      (collection) => collection.definition.collectionId === PRODUCTS_COLLECTION_ID,
    )!
    const pumpA = products.items.find((item) => item.meta.itemId === ITEM_IDS.pumpA)!
    pumpA.locales.en = {
      ...pumpA.locales.en!,
      slug: 'series-alpha',
    }

    expect(() => assertNoUrlConflicts(model)).toThrow(UrlConflictError)
    try {
      assertNoUrlConflicts(model)
    } catch (error) {
      expect(error).toBeInstanceOf(UrlConflictError)
      const message = (error as Error).message
      expect(message).toMatch(/series-alpha/)
      expect(message).toMatch(/source\/collections\//)
    }
  })

  it('页面 slug 与内容类型 prefix 相同时抛出含路径的错误', async () => {
    const model = await loadFullSite()
    const about = model.pages.find((page) => page.meta.pageId === PAGE_IDS.about)!
    about.locales.en = {
      ...about.locales.en!,
      slug: 'products',
    }

    expect(() => assertNoUrlConflicts(model)).toThrow(UrlConflictError)
    try {
      assertNoUrlConflicts(model)
    } catch (error) {
      const message = (error as Error).message
      expect(message).toMatch(/products/)
      expect(message).toMatch(/source\/pages\//)
    }
  })

  it('同语言重复页面地址时抛出含路径的错误', async () => {
    const model = await loadFullSite()
    const about = model.pages.find((page) => page.meta.pageId === PAGE_IDS.about)!
    const contact = model.pages.find((page) => page.meta.pageId === PAGE_IDS.contact)!
    contact.locales.en = {
      ...contact.locales.en!,
      slug: about.locales.en!.slug,
    }

    expect(() => assertNoUrlConflicts(model)).toThrow(UrlConflictError)
    try {
      assertNoUrlConflicts(model)
    } catch (error) {
      const message = (error as Error).message
      expect(message).toMatch(/\/en\/about\//)
      expect(message).toMatch(/source\/pages\//)
    }
  })

  it('完整 fixture 无地址冲突', async () => {
    const model = await loadFullSite()
    expect(() => assertNoUrlConflicts(model)).not.toThrow()
  })
})

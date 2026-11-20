import { describe, expect, it } from 'vitest'
import {
  resolveContentRef,
  ContentRefResolveError,
  type LinkResolveMode,
} from './links.js'
import { loadSiteModel, type SiteModel } from './site-model.js'
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

describe('ContentRef 解析', () => {
  it('解析 page、collection、group、item 四类引用为相对地址', async () => {
    const model = await loadFullSite()
    const from = '/en/about/'

    expect(resolveContentRef(model, { ref: 'page', id: PAGE_IDS.contact }, {
      locale: 'en',
      fromUrl: from,
      mode: 'publish',
    })).toBe('../contact/')

    expect(resolveContentRef(model, { ref: 'collection', id: PRODUCTS_COLLECTION_ID }, {
      locale: 'en',
      fromUrl: from,
      mode: 'publish',
    })).toBe('../products/')

    expect(resolveContentRef(model, { ref: 'group', id: GROUP_IDS.catAlpha1 }, {
      locale: 'en',
      fromUrl: from,
      mode: 'publish',
    })).toBe('../products/series-alpha/cat-alpha-1/')

    expect(resolveContentRef(model, { ref: 'item', id: ITEM_IDS.pumpA }, {
      locale: 'en',
      fromUrl: from,
      mode: 'publish',
    })).toBe('../products/pump-a/')
  })

  it('publish 模式拒绝未发布对象，错误含对象路径', async () => {
    const model = await loadFullSite()
    const about = model.pages.find((page) => page.meta.pageId === PAGE_IDS.about)!
    about.meta = { ...about.meta, status: 'draft' }

    expect(() => resolveContentRef(model, { ref: 'page', id: PAGE_IDS.about }, {
      locale: 'en',
      fromUrl: '/en/',
      mode: 'publish',
    })).toThrow(ContentRefResolveError)

    try {
      resolveContentRef(model, { ref: 'page', id: PAGE_IDS.about }, {
        locale: 'en',
        fromUrl: '/en/',
        mode: 'publish',
      })
    } catch (error) {
      const message = (error as Error).message
      expect(message).toMatch(/draft|未发布/)
      expect(message).toMatch(/source\/pages\//)
    }
  })

  it('preview 模式允许未发布对象', async () => {
    const model = await loadFullSite()
    const about = model.pages.find((page) => page.meta.pageId === PAGE_IDS.about)!
    about.meta = { ...about.meta, status: 'draft' }

    const modes: LinkResolveMode[] = ['preview']
    for (const mode of modes) {
      expect(resolveContentRef(model, { ref: 'page', id: PAGE_IDS.about }, {
        locale: 'en',
        fromUrl: '/en/',
        mode,
      })).toBe('about/')
    }
  })

  it('preview 模式缺少目标语言时链接到该语言首页', async () => {
    const model = await loadFullSite()
    const about = model.pages.find((page) => page.meta.pageId === PAGE_IDS.about)!
    delete about.locales['zh-CN']

    expect(resolveContentRef(model, { ref: 'page', id: PAGE_IDS.about }, {
      locale: 'zh-CN',
      fromUrl: '/zh-CN/contact/',
      mode: 'preview',
    })).toBe('../')
  })

  it('publish 模式缺少目标语言时抛出含路径的错误', async () => {
    const model = await loadFullSite()
    const about = model.pages.find((page) => page.meta.pageId === PAGE_IDS.about)!
    delete about.locales['zh-CN']

    expect(() => resolveContentRef(model, { ref: 'page', id: PAGE_IDS.about }, {
      locale: 'zh-CN',
      fromUrl: '/zh-CN/',
      mode: 'publish',
    })).toThrow(ContentRefResolveError)

    try {
      resolveContentRef(model, { ref: 'page', id: PAGE_IDS.about }, {
        locale: 'zh-CN',
        fromUrl: '/zh-CN/',
        mode: 'publish',
      })
    } catch (error) {
      expect((error as Error).message).toMatch(/source\/pages\//)
    }
  })

  it('引用不存在时抛出含引用信息的错误', async () => {
    const model = await loadFullSite()
    expect(() => resolveContentRef(model, {
      ref: 'page',
      id: '00000000-0000-4000-8000-000000000000',
    }, {
      locale: 'en',
      fromUrl: '/en/',
      mode: 'publish',
    })).toThrow(ContentRefResolveError)
  })
})

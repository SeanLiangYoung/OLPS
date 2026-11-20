import { describe, expect, it } from 'vitest'
import { PAGE_IDS, PRODUCTS_COLLECTION_ID, ITEM_IDS } from './test-support/fixture-ids.js'
import { loadFullSite } from './test-support/load-full-site.js'
import { buildSeoHead } from './seo-head.js'

describe('seo-head', () => {
  it('输出 canonical、hreflang、x-default、Open Graph', async () => {
    const { model } = await loadFullSite()
    const head = buildSeoHead(model, {
      kind: 'page',
      pageId: PAGE_IDS.about,
      locale: 'en',
      mode: 'publish',
    })
    expect(head.canonical).toBe('https://www.example.com/en/about/')
    expect(head.title).toBe('About Acme')
    expect(head.description).toBe('About our company')
    expect(head.hreflang).toEqual(
      expect.arrayContaining([
        { hreflang: 'en', href: 'https://www.example.com/en/about/' },
        { hreflang: 'zh-CN', href: 'https://www.example.com/zh-CN/about/' },
        { hreflang: 'x-default', href: 'https://www.example.com/en/about/' },
      ]),
    )
    expect(head.openGraph).toMatchObject({
      title: 'About Acme',
      description: 'About our company',
      url: 'https://www.example.com/en/about/',
      locale: 'en',
    })
    expect(head.twitter).toMatchObject({
      card: 'summary',
      title: 'About Acme',
      description: 'About our company',
    })
    expect(head.noindex).toBe(false)
  })

  it('thank-you、404、preview 与关闭收录时输出 noindex', async () => {
    const { model } = await loadFullSite()
    const thankYou = buildSeoHead(model, {
      kind: 'page',
      pageId: PAGE_IDS.thankYou,
      locale: 'en',
      mode: 'publish',
    })
    expect(thankYou.noindex).toBe(true)

    const notFound = buildSeoHead(model, {
      kind: 'page',
      pageId: PAGE_IDS.notFound,
      locale: 'en',
      mode: 'publish',
    })
    expect(notFound.noindex).toBe(true)

    const preview = buildSeoHead(model, {
      kind: 'page',
      pageId: PAGE_IDS.about,
      locale: 'en',
      mode: 'preview',
    })
    expect(preview.noindex).toBe(true)

    const closed = structuredClone(model)
    closed.settings.search.allowIndexing = false
    const closedHead = buildSeoHead(closed, {
      kind: 'item',
      collectionId: PRODUCTS_COLLECTION_ID,
      itemId: ITEM_IDS.pumpA,
      locale: 'en',
      mode: 'publish',
    })
    expect(closedHead.noindex).toBe(true)
  })
})

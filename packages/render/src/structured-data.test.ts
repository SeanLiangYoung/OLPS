import { describe, expect, it } from 'vitest'
import {
  GROUP_IDS,
  ITEM_IDS,
  PAGE_IDS,
  PRODUCTS_COLLECTION_ID,
} from './test-support/fixture-ids.js'
import { loadFullSite } from './test-support/load-full-site.js'
import { buildStructuredData } from './structured-data.js'

describe('structured-data', () => {
  it('输出 Organization、WebSite、LocalBusiness、Product、ItemList、BreadcrumbList、FAQPage', async () => {
    const { model } = await loadFullSite()

    const home = buildStructuredData(model, {
      kind: 'page',
      pageId: PAGE_IDS.home,
      locale: 'en',
      mode: 'publish',
    })
    const homeTypes = home.map((entry) => entry['@type'])
    expect(homeTypes).toEqual(expect.arrayContaining(['Organization', 'WebSite']))

    const contact = buildStructuredData(model, {
      kind: 'page',
      pageId: PAGE_IDS.contact,
      locale: 'en',
      mode: 'publish',
    })
    expect(contact.map((entry) => entry['@type'])).toContain('LocalBusiness')

    const about = buildStructuredData(model, {
      kind: 'page',
      pageId: PAGE_IDS.about,
      locale: 'en',
      mode: 'publish',
    })
    expect(about.map((entry) => entry['@type'])).toContain('FAQPage')

    const item = buildStructuredData(model, {
      kind: 'item',
      collectionId: PRODUCTS_COLLECTION_ID,
      itemId: ITEM_IDS.pumpA,
      locale: 'en',
      mode: 'publish',
    })
    const itemTypes = item.map((entry) => entry['@type'])
    expect(itemTypes).toEqual(expect.arrayContaining(['Product', 'BreadcrumbList']))

    const list = buildStructuredData(model, {
      kind: 'group',
      collectionId: PRODUCTS_COLLECTION_ID,
      groupId: GROUP_IDS.catAlpha1,
      locale: 'en',
      mode: 'publish',
    })
    expect(list.map((entry) => entry['@type'])).toContain('ItemList')
  })

  it('缺少 Organization 必需属性时抛出错误', async () => {
    const { model } = await loadFullSite()
    const broken = structuredClone(model)
    broken.settings.company.name = ''
    expect(() =>
      buildStructuredData(broken, {
        kind: 'page',
        pageId: PAGE_IDS.home,
        locale: 'en',
        mode: 'publish',
      }),
    ).toThrow(/Organization|name/i)
  })
})

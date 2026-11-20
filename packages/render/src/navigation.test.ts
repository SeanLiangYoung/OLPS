import { describe, expect, it } from 'vitest'
import {
  GROUP_IDS,
  ITEM_IDS,
  PRODUCTS_COLLECTION_ID,
} from './test-support/fixture-ids.js'
import { loadFullSite } from './test-support/load-full-site.js'
import {
  buildBreadcrumbs,
  buildItemNavigation,
  buildListData,
} from './navigation.js'

describe('navigation', () => {
  it('条目多分组时面包屑按主分组生成', async () => {
    const { model } = await loadFullSite()
    const crumbs = buildBreadcrumbs(model, {
      kind: 'item',
      collectionId: PRODUCTS_COLLECTION_ID,
      itemId: ITEM_IDS.pumpA,
      locale: 'en',
    })
    expect(crumbs.map((crumb) => crumb.title)).toEqual([
      'Home',
      'Products',
      'Series Alpha',
      'Category Alpha 1',
      'Pump A',
    ])
    expect(crumbs.at(-2)?.url).toBe('/en/products/series-alpha/cat-alpha-1/')
  })

  it('提供上一篇、下一篇与相关条目', async () => {
    const { model } = await loadFullSite()
    const navigation = buildItemNavigation(model, {
      collectionId: PRODUCTS_COLLECTION_ID,
      itemId: ITEM_IDS.pumpA,
      locale: 'en',
      mode: 'publish',
    })
    expect(navigation.previous).toBeNull()
    expect(navigation.next?.title).toBe('Pump B')
    expect(navigation.related.map((entry) => entry.title)).toContain('Pump B')
    expect(navigation.related.every((entry) => entry.id !== ITEM_IDS.pumpA)).toBe(true)
  })

  it('列表与分页数据按主分组子项组装', async () => {
    const { model } = await loadFullSite()
    const list = buildListData(model, {
      kind: 'group',
      collectionId: PRODUCTS_COLLECTION_ID,
      groupId: GROUP_IDS.catAlpha1,
      locale: 'en',
      mode: 'publish',
      pageNumber: 1,
      pageSize: 10,
      sort: 'manual',
    })
    expect(list.items.map((item) => item.title)).toEqual(['Pump A', 'Pump B'])
    expect(list.pageNumber).toBe(1)
    expect(list.totalPages).toBe(1)
    expect(list.totalItems).toBe(2)
  })
})

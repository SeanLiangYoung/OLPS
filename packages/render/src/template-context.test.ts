import { describe, expect, it } from 'vitest'
import {
  GROUP_IDS,
  ITEM_IDS,
  PAGE_IDS,
  PRODUCTS_COLLECTION_ID,
} from './test-support/fixture-ids.js'
import { loadFullSite } from './test-support/load-full-site.js'
import { buildTemplateContext } from './template-context.js'

describe('template-context', () => {
  it('组装 site、locale、menus、content 与导航数据', async () => {
    const { model, reader } = await loadFullSite()
    const context = await buildTemplateContext(model, {
      kind: 'item',
      collectionId: PRODUCTS_COLLECTION_ID,
      itemId: ITEM_IDS.pumpA,
      locale: 'en',
      mode: 'publish',
      reader,
      contentHtml: '<p>Pump A</p>',
    })

    expect(context.site.siteName).toBe('Acme Manufacturing')
    expect(context.locale).toEqual({ code: 'en', dir: 'ltr' })
    expect(context.locales).toHaveLength(2)
    expect(context.alternates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'zh-CN' }),
      ]),
    )
    expect(context.menus.primary[0].label).toBe('Home')
    expect(context.menus.primary[0].url).toContain('../')
    expect(context.item?.title).toBe('Pump A')
    expect(context.content).toBe('<p>Pump A</p>')
    expect(context.breadcrumbs?.length).toBeGreaterThan(2)
    expect(context.next?.title).toBe('Pump B')
    expect(context.related?.some((entry) => entry.title === 'Pump B')).toBe(true)
  })

  it('列表页提供 list 分页数据', async () => {
    const { model, reader } = await loadFullSite()
    const context = await buildTemplateContext(model, {
      kind: 'group',
      collectionId: PRODUCTS_COLLECTION_ID,
      groupId: GROUP_IDS.seriesAlpha,
      locale: 'en',
      mode: 'publish',
      reader,
      contentHtml: '',
      pageNumber: 1,
    })
    expect(context.group?.title).toBe('Series Alpha')
    expect(context.list).toBeDefined()
    expect(context.list?.items.length).toBeGreaterThan(0)
  })

  it('页面上下文包含 page 对象', async () => {
    const { model, reader } = await loadFullSite()
    const context = await buildTemplateContext(model, {
      kind: 'page',
      pageId: PAGE_IDS.home,
      locale: 'en',
      mode: 'publish',
      reader,
      contentHtml: '<p>Home</p>',
    })
    expect(context.page?.title).toBe('Home')
    expect(context.page?.role).toBe('home')
  })
})

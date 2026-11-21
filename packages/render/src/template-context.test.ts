import { describe, expect, it } from 'vitest'
import {
  GROUP_IDS,
  ITEM_IDS,
  PAGE_IDS,
  PRODUCTS_COLLECTION_ID,
} from './test-support/fixture-ids.js'
import { loadFullSite } from './test-support/load-full-site.js'
import { buildTemplateContext } from './template-context.js'
import { renderTarget } from './render-document.js'
import { buildSeoHead } from './seo-head.js'

describe('template-context', () => {
  it('列表模板与区块使用相同的分页、分组和标题排序', async () => {
    const {model,reader}=await loadFullSite()
    const collection=model.collections.find(entry=>entry.definition.collectionId===PRODUCTS_COLLECTION_ID)!
    const original=collection.items[0]!
    collection.items=Array.from({length:8},(_,index)=>{
      const item=structuredClone(original)
      item.meta.itemId=`66666666-6666-4666-8666-${String(index+100).padStart(12,'0')}`
      item.meta.order=8-index
      item.meta.groupIds=[GROUP_IDS.catAlpha1];item.meta.primaryGroupId=GROUP_IDS.catAlpha1
      for(const document of Object.values(item.locales)){document.title=`Product ${index+1}`;document.slug=`product-${index+1}`}
      return item
    })
    const group=collection.groups.find(entry=>entry.meta.groupId===GROUP_IDS.catAlpha1)!
    group.meta.parentGroupId=null
    for(const document of [collection.indexLocales.en!,group.locales.en!])document.blocks=[{id:'paginated-list',type:'core/collection-list',props:{source:'current',pageSize:3,sort:'title'},children:[]}]
    for(const item of collection.items.slice(3))delete item.locales['zh-CN']
    for(const kind of ['collection','group'] as const){
      if(kind==='collection')collection.groups=[]
      else collection.groups=[group]
      const target=kind==='collection'?{kind,collectionId:PRODUCTS_COLLECTION_ID}:{kind,collectionId:PRODUCTS_COLLECTION_ID,groupId:GROUP_IDS.catAlpha1}
      for(const pageNumber of [2,3]){
        const context=await buildTemplateContext(model,{...target,reader,locale:'en',mode:'publish',contentHtml:'',pageNumber})
        expect(context.list).toMatchObject({pageNumber,pageSize:3,totalItems:8,totalPages:3})
        expect(context.list!.items.map(item=>item.title)).toEqual(pageNumber===2?['Product 4','Product 5','Product 6']:['Product 7','Product 8'])
        const prefix=kind==='collection'?'/en/products/':'/en/products/cat-alpha-1/'
        const current=`https://example.com${prefix}page/${pageNumber}/`
        expect(new URL(context.menus.primary[0].url,current).pathname).toBe('/en/')
        const alternate=context.alternates.find(entry=>entry.code==='zh-CN')!
        expect(new URL(alternate.url,current).pathname).not.toContain('/page/')
        const seo=buildSeoHead(model,{...target,locale:'en',mode:'publish',pageNumber})
        expect(seo.canonical).toContain(`/page/${pageNumber}/`)
        expect(seo.hreflang.find(entry=>entry.hreflang==='zh-CN')!.href).not.toContain('/page/')
        const html=await renderTarget(model,target,'en',{reader,mode:'publish',pageNumber})
        expect(html).toContain(pageNumber===2?'Product 4':'Product 7')
      }
    }
  })
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

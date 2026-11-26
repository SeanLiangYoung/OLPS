import { describe, expect, it } from 'vitest'
import {
  CMS_SIDEBAR_MENU,
  buildCmsSidebarMenu,
  resolveCmsSidebarOpenGroup,
} from './cmsSidebarMenu'

describe('cmsSidebarMenu', () => {
  it('在全部内容类型之后插入动态 collection', () => {
    const menu = buildCmsSidebarMenu([
      { meta: { collectionId: 'products' }, locale: { title: '产品' } },
      { meta: { collectionId: 'news' }, locale: { title: '新闻' } },
    ])
    const content = menu.find((entry) => entry.type === 'group' && entry.index === 'content')
    expect(content?.type).toBe('group')
    if (content?.type !== 'group') throw new Error('缺少网站内容分组')
    const indexes = content.children.map((child) => child.index)
    expect(indexes.indexOf('/collections')).toBeLessThan(indexes.indexOf('/collections/products'))
    expect(indexes.indexOf('/collections/products')).toBeLessThan(indexes.indexOf('/collections/news'))
    expect(indexes.indexOf('/collections/news')).toBeLessThan(indexes.indexOf('/media'))
    expect(content.children.find((child) => child.index === '/collections/products')?.title).toBe('产品')
  })

  it('根据激活项解析应当展开的二级菜单', () => {
    const menu = buildCmsSidebarMenu([])
    expect(resolveCmsSidebarOpenGroup('/dashboard', menu)).toBeNull()
    expect(resolveCmsSidebarOpenGroup('/pages', menu)).toBe('content')
    expect(resolveCmsSidebarOpenGroup('/appearance/themes', menu)).toBe('appearance')
    expect(resolveCmsSidebarOpenGroup('/publish', menu)).toBe('data')
    expect(resolveCmsSidebarOpenGroup('/settings/members', menu)).toBe('settings')
  })

  it('网站概况保持为一级入口', () => {
    const first = CMS_SIDEBAR_MENU[0]
    expect(first).toEqual({ type: 'item', index: '/dashboard', title: '网站概况' })
  })
})

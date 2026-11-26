export type CmsSidebarMenuItem = {
  index: string
  title: string
}

export type CmsSidebarMenuGroup = {
  index: string
  title: string
  children: CmsSidebarMenuItem[]
  /** 在指定子项之后插入动态 content type 菜单 */
  insertCollectionsAfter?: string
}

export type CmsSidebarMenuEntry =
  | ({ type: 'item' } & CmsSidebarMenuItem)
  | ({ type: 'group' } & CmsSidebarMenuGroup)

export const CMS_SIDEBAR_MENU: CmsSidebarMenuEntry[] = [
  { type: 'item', index: '/dashboard', title: '网站概况' },
  {
    type: 'group',
    index: 'autopilot',
    title: '自动驾驶',
    children: [
      { index: '/knowledge', title: '网站资料' },
      { index: '/generate', title: 'AI 建站' },
    ],
  },
  {
    type: 'group',
    index: 'content',
    title: '网站内容',
    insertCollectionsAfter: '/collections',
    children: [
      { index: '/pages', title: '页面管理' },
      { index: '/collections', title: '全部内容类型' },
      { index: '/media', title: '媒体资料' },
    ],
  },
  {
    type: 'group',
    index: 'appearance',
    title: '外观与功能',
    children: [
      { index: '/appearance/themes', title: '主题' },
      { index: '/appearance/customize', title: '外观定制' },
      { index: '/appearance/menus', title: '导航菜单' },
      { index: '/appearance/texts', title: '固定文字' },
      { index: '/plugins', title: '插件' },
    ],
  },
  {
    type: 'group',
    index: 'data',
    title: '数据与发布',
    children: [
      { index: '/inquiries', title: '客户询盘' },
      { index: '/reports', title: '统计与报告' },
      { index: '/integrations', title: '营销连接' },
      { index: '/publish', title: '发布记录与协作' },
    ],
  },
  {
    type: 'group',
    index: 'settings',
    title: '网站设置',
    children: [
      { index: '/settings/general', title: '常规设置' },
      { index: '/settings/search', title: '搜索设置' },
      { index: '/settings/content-types', title: '内容类型设置' },
      { index: '/settings/targets', title: '发布目标' },
      { index: '/settings/members', title: '网站成员' },
    ],
  },
]

export type CmsSidebarCollection = {
  meta: { collectionId: string }
  locale: { title: string }
}

/** 将静态菜单与动态 content type 合并为可直接渲染的菜单树 */
export function buildCmsSidebarMenu(
  collections: CmsSidebarCollection[],
): CmsSidebarMenuEntry[] {
  return CMS_SIDEBAR_MENU.map((entry) => {
    if (entry.type !== 'group' || !entry.insertCollectionsAfter) return entry
    const anchor = entry.insertCollectionsAfter
    const children: CmsSidebarMenuItem[] = []
    for (const child of entry.children) {
      children.push(child)
      if (child.index === anchor) {
        for (const collection of collections) {
          children.push({
            index: `/collections/${collection.meta.collectionId}`,
            title: collection.locale.title,
          })
        }
      }
    }
    return { ...entry, children }
  })
}

/** 根据当前激活菜单项，找出应当展开的二级菜单 index */
export function resolveCmsSidebarOpenGroup(
  activeIndex: string,
  menu: CmsSidebarMenuEntry[],
): string | null {
  for (const entry of menu) {
    if (entry.type !== 'group') continue
    if (entry.children.some((child) => child.index === activeIndex)) {
      return entry.index
    }
  }
  return null
}

export type CmsBreadcrumbItem = {
  label: string
  to?: string
}

const ROUTE_BREADCRUMBS: Array<{ match: (path: string) => boolean; items: CmsBreadcrumbItem[] }> = [
  { match: (path) => path === '/dashboard', items: [{ label: '网站概况' }] },
  { match: (path) => path === '/pages', items: [{ label: '网站内容' }, { label: '页面管理' }] },
  { match: (path) => path === '/collections', items: [{ label: '网站内容' }, { label: '全部内容类型' }] },
  {
    match: (path) => path.startsWith('/collections/'),
    items: [{ label: '网站内容' }, { label: '内容类型' }],
  },
  {
    match: (path) => path.startsWith('/content/'),
    items: [{ label: '网站内容' }, { label: '编辑内容' }],
  },
  { match: (path) => path === '/media', items: [{ label: '网站内容' }, { label: '媒体资料' }] },
  { match: (path) => path === '/knowledge', items: [{ label: '网站内容' }, { label: '网站资料' }] },
  { match: (path) => path === '/generate', items: [{ label: '网站内容' }, { label: 'AI 建站' }] },
  { match: (path) => path === '/appearance/themes', items: [{ label: '外观与功能' }, { label: '主题' }] },
  {
    match: (path) => path === '/appearance/customize',
    items: [{ label: '外观与功能' }, { label: '外观定制' }],
  },
  { match: (path) => path === '/appearance/menus', items: [{ label: '外观与功能' }, { label: '导航菜单' }] },
  { match: (path) => path === '/appearance/texts', items: [{ label: '外观与功能' }, { label: '固定文字' }] },
  { match: (path) => path === '/plugins', items: [{ label: '外观与功能' }, { label: '插件' }] },
  { match: (path) => path === '/inquiries', items: [{ label: '数据与发布' }, { label: '客户询盘' }] },
  { match: (path) => path === '/reports', items: [{ label: '数据与发布' }, { label: '统计与报告' }] },
  { match: (path) => path === '/integrations', items: [{ label: '数据与发布' }, { label: '营销连接' }] },
  { match: (path) => path === '/publish', items: [{ label: '数据与发布' }, { label: '发布记录与协作' }] },
  { match: (path) => path === '/settings/general' || path === '/settings', items: [{ label: '网站设置' }, { label: '常规设置' }] },
  { match: (path) => path === '/settings/search', items: [{ label: '网站设置' }, { label: '搜索设置' }] },
  {
    match: (path) => path === '/settings/content-types',
    items: [{ label: '网站设置' }, { label: '内容类型设置' }],
  },
  { match: (path) => path === '/settings/targets', items: [{ label: '网站设置' }, { label: '发布目标' }] },
  { match: (path) => path === '/settings/members', items: [{ label: '网站设置' }, { label: '网站成员' }] },
]

export function resolveCmsBreadcrumbs(path: string): CmsBreadcrumbItem[] {
  for (const entry of ROUTE_BREADCRUMBS) {
    if (entry.match(path)) return entry.items
  }
  return []
}

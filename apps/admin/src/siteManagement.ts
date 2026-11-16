import type { PublishedSite, SiteDraft } from './types'

export type PublicationIssue = { code: string; message: string; pageId?: string; path?: string }
export type PublicationOperation = 'publish' | 'unpublish' | 'delete' | 'none'
export type ManagedPage = {
  pageId: string
  title: string
  slug: string
  kind: string
  locale: string
  operation: PublicationOperation
  onlineStatus: 'published' | 'unpublished'
  changed: boolean
  updatedAt: string
  issues: readonly PublicationIssue[]
  publicUrls?: string[]
}
export type PublicationOverview = {
  pages: ManagedPage[]
  settingsChanged: boolean
  issues: PublicationIssue[]
  site?: PublishedSite | null
}
export type PublicationPreview = PublicationOverview & { token: string | null; taskId?: string; expiresAt: string; baseCommitId?: string | null }
export type ManagedSite = PublishedSite & { drafts: SiteDraft[] }

export function filterManagedPages<T extends ManagedPage>(pages: T[], filters: { search: string; kind: string; locale: string; state: string; sort?: string }): T[] {
  const search = filters.search.trim().toLocaleLowerCase()
  return pages.filter(page => {
    if (search && !`${page.title} ${page.slug}`.toLocaleLowerCase().includes(search)) return false
    if (filters.kind !== 'all' && page.kind !== filters.kind) return false
    if (filters.locale && page.locale !== filters.locale) return false
    if (filters.state === 'changed' && !page.changed) return false
    if (filters.state === 'published' && page.onlineStatus !== 'published') return false
    if (filters.state === 'unpublished' && page.onlineStatus === 'published') return false
    return true
  }).sort((a, b) => filters.sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : filters.sort === 'oldest' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt))
}

export function publicationOperationLabel(operation: PublicationOperation): string {
  return { publish: '发布更新', unpublish: '停止展示', delete: '删除线上页面', none: '保持线上内容' }[operation]
}

export function pageChangeLabel(page: Pick<ManagedPage, 'operation' | 'changed' | 'onlineStatus'>): string {
  if (!page.changed) return '没有未发布更改'
  if (page.operation === 'delete') return '等待删除'
  if (page.operation === 'unpublish') return '等待停止展示'
  return page.onlineStatus === 'published' ? '有未发布更改' : '等待首次发布'
}

export function rememberSiteDraft(siteId: string, draftId: string): void {
  localStorage.setItem(`olps_site_draft_${siteId}`, draftId)
}

export function recalledSiteDraft(siteId: string, drafts: Array<{ draftId: string }>): string {
  const stored = localStorage.getItem(`olps_site_draft_${siteId}`)
  return drafts.some(draft => draft.draftId === stored) ? stored! : ''
}

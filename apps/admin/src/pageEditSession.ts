import type { PageRecord } from './types'

export type PageEditSnapshot = { content: string; guide: string }

export function pageEditSnapshot(page: PageRecord): PageEditSnapshot {
  const ads = page.body.ads
  return {
    content: JSON.stringify({
      title: page.title,
      seo: page.seo,
      body: { ...page.body, ads: ads ? { ...ads, guide: undefined } : undefined },
    }),
    guide: JSON.stringify(ads?.guide ?? null),
  }
}

export function protectPageUnload(event: BeforeUnloadEvent, shouldWarn: boolean): void {
  if (!shouldWarn) return
  event.preventDefault()
  event.returnValue = ''
}

export class PageEditSession {
  generation = 0
  pending = false
  saveFailed = false
  savedDuringOperation = false
  savedSnapshot: PageEditSnapshot | null = null

  acceptSaved(snapshot: PageEditSnapshot, scope: 'all' | 'guide' = 'all'): void {
    if (scope === 'guide') {
      if (!this.savedSnapshot) throw new Error('页面尚未载入保存记录')
      this.savedSnapshot = { ...this.savedSnapshot, guide: snapshot.guide }
    } else {
      this.savedSnapshot = { ...snapshot }
    }
    this.saveFailed = false
    this.savedDuringOperation = true
  }

  hasUnsaved(page: PageRecord): boolean {
    if (!this.savedSnapshot) return false
    const current = pageEditSnapshot(page)
    return current.content !== this.savedSnapshot.content || current.guide !== this.savedSnapshot.guide
  }

  needsLeaveWarning(page: PageRecord | null): boolean {
    return this.pending || Boolean(page && this.hasUnsaved(page))
  }

  saveStatus(page: PageRecord): string {
    if (this.pending) return '正在保存…'
    if (this.saveFailed) return '保存失败，输入已保留，请重试'
    return this.hasUnsaved(page) ? '有未保存修改' : '已保存'
  }

  reset(): number {
    this.generation += 1
    this.pending = false
    this.saveFailed = false
    this.savedDuringOperation = false
    this.savedSnapshot = null
    return this.generation
  }

  begin(): number | null {
    if (this.pending) return null
    this.pending = true
    this.saveFailed = false
    this.savedDuringOperation = false
    return this.generation
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation
  }

  finish(generation: number): void {
    if (this.isCurrent(generation)) this.pending = false
  }
}

export function applySavedPageMetadata(current: PageRecord, saved: PageRecord): void {
  if (current.pageId !== saved.pageId) throw new Error('保存响应的 pageId 与当前页面不一致')
  current.updatedAt = saved.updatedAt
}

import type { EditorContent } from './editor/document'

export type PageEditSnapshot = string

export function pageEditSnapshot(page: EditorContent): PageEditSnapshot {
  return JSON.stringify({...page,meta:{...page.meta,createdAt:undefined,updatedAt:undefined},locale:{...page.locale,updatedAt:undefined}})
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

  acceptSaved(snapshot: PageEditSnapshot): void {
    this.savedSnapshot = snapshot
    this.saveFailed = false
    this.savedDuringOperation = true
  }

  hasUnsaved(page: EditorContent): boolean {
    if (this.savedSnapshot === null) return false
    return pageEditSnapshot(page) !== this.savedSnapshot
  }

  needsLeaveWarning(page: EditorContent | null): boolean {
    return this.pending || Boolean(page && this.hasUnsaved(page))
  }

  saveStatus(page: EditorContent): string {
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

export function applySavedPageMetadata(current: EditorContent, saved: EditorContent): void {
  const key=`${current.ref}Id`
  if (current.ref!==saved.ref||current.meta[key] !== saved.meta[key]||current.locale.locale!==saved.locale.locale) throw new Error('保存响应的内容标识与当前内容不一致')
  current.meta.updatedAt = saved.meta.updatedAt
  current.locale.updatedAt = saved.locale.updatedAt
}

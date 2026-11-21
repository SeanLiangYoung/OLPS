import { ref } from 'vue'
import { api, setSelectedDraftId } from './api'
import { selectedDraftNameState, selectedSiteIdState, selectedSiteNameState } from './workspaceSession'

export type CmsSite = { siteId: string; name: string; status: 'published' | 'unpublished'; publicUrl: string | null }
export type CmsDraft = { draftId: string; siteId: string; name: string; initStatus: 'initializing' | 'ready' | 'failed'; syncStatus: string; error?: string | null }
export const contentLocale = ref(localStorage.getItem('olps_content_locale') ?? 'en')

export function selectLocale(locale: string): void {
  localStorage.setItem('olps_content_locale', locale)
  contentLocale.value = locale
}

export function selectSite(site: CmsSite): void {
  if (selectedSiteIdState.value !== site.siteId) setSelectedDraftId('')
  selectedSiteIdState.value = site.siteId
  selectedSiteNameState.value = site.name
  localStorage.setItem('olps_site_id', site.siteId)
}

export function selectDraft(draft: CmsDraft): void {
  if (draft.initStatus !== 'ready') throw new Error('网站尚未完成初始化')
  setSelectedDraftId(draft.draftId)
  selectedDraftNameState.value = draft.name
}

export async function siteDrafts(siteId: string): Promise<CmsDraft[]> {
  return (await api<{ drafts: CmsDraft[] }>('GET', `/api/sites/${encodeURIComponent(siteId)}/drafts`)).drafts
}

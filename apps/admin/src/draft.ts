import { api } from './api'
import { getSelectedDraftId } from './session'
import type { PublishedSite, SiteDraft } from './types'

export async function listPublishedSites(): Promise<PublishedSite[]> {
  const listed = await api<{ sites: PublishedSite[] }>('GET', '/api/sites')
  return listed.sites ?? []
}

export async function listDrafts(): Promise<SiteDraft[]> {
  const listed = await api<{ drafts: SiteDraft[] }>('GET', '/api/drafts')
  return listed.drafts ?? []
}

export async function createDraft(input: {
  name: string
  siteId?: string
}): Promise<SiteDraft> {
  const data = await api<{ draft: SiteDraft }>('POST', '/api/drafts', input)
  return data.draft
}

export async function fetchDraft(draftId: string): Promise<SiteDraft> {
  const data = await api<{ draft: SiteDraft }>('GET', `/api/drafts/${draftId}`)
  return data.draft
}

export function requireSelectedDraftId(): string {
  const draftId = getSelectedDraftId()
  if (!draftId) throw new Error('尚未选择工作草稿')
  return draftId
}

export async function pullDraft(draftId: string): Promise<SiteDraft> {
  const data = await api<{ draft: SiteDraft }>('POST', `/api/drafts/${draftId}/pull`)
  return data.draft
}

export async function pushDraft(draftId: string): Promise<{
  draft: SiteDraft
  site?: PublishedSite
}> {
  return api('POST', `/api/drafts/${draftId}/push`)
}

export async function continueDraftSync(
  draftId: string,
  userMessage: string,
): Promise<SiteDraft> {
  const data = await api<{ draft: SiteDraft }>(
    'POST',
    `/api/drafts/${draftId}/continue`,
    { userMessage },
  )
  return data.draft
}

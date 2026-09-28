export function draftPageDetailRoute(draftId: string, pageId: string): string {
  return `/drafts/${draftId}/pages/${pageId}`
}

export function draftPageDetailApiPath(draftId: string, pageId: string): string {
  return `/api/drafts/${draftId}/pages/${pageId}`
}

export function draftPageGuideApiPath(draftId: string, pageId: string): string {
  return `${draftPageDetailApiPath(draftId, pageId)}/guide`
}

export function draftPageGuideValidateApiPath(draftId: string, pageId: string): string {
  return `${draftPageGuideApiPath(draftId, pageId)}/validate`
}

export function draftPagePreviewApiPath(draftId: string, pageId: string): string {
  return `${draftPageDetailApiPath(draftId, pageId)}/preview`
}

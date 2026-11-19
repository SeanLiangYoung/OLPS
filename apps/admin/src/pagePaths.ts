export function draftPageDetailRoute(draftId: string, pageId: string): string {
  return `/drafts/${draftId}/pages/${pageId}`
}

export function draftPageDetailApiPath(draftId: string, pageId: string): string {
  return `/api/drafts/${draftId}/pages/${pageId}`
}

export function draftPagePreviewApiPath(draftId: string, pageId: string): string {
  return `${draftPageDetailApiPath(draftId, pageId)}/preview`
}

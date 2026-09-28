export function pageDraftMismatchMessage(
  currentDraftId: string,
  pageDraftId: string | null | undefined,
): string {
  if (!pageDraftId) return ''
  if (pageDraftId === currentDraftId) return ''
  return '该页面属于其他草稿，请在工作区切换到对应草稿后再编辑'
}

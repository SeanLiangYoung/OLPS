/** 路由或 API 上下文中的 draftId 须与当前选中的工作草稿一致。 */
export function pageDraftMismatchMessage(
  selectedDraftId: string,
  routeOrContextDraftId: string | null | undefined,
): string {
  if (!routeOrContextDraftId) return ''
  if (routeOrContextDraftId === selectedDraftId) return ''
  return '该页面属于其他草稿，请在工作区切换到对应草稿后再编辑'
}

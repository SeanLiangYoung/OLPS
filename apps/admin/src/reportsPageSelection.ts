export function reconcilePageIdForSite(
  previousPageId: string,
  sitePages: Array<{ pageId: string }>,
): string {
  if (
    previousPageId &&
    sitePages.some((page) => page.pageId === previousPageId)
  ) {
    return previousPageId
  }
  return sitePages[0]?.pageId ?? ''
}

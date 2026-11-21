export function resolveNavigationGuard(
  path: string,
  accessToken: string,
  draftId: string,
  siteId: string,
): true | '/login' | '/sites' {
  if (path === '/login') return true
  if (!accessToken) return '/login'
  if (path === '/sites' || path === '/workspace') return true
  if (!draftId || !siteId) return '/sites'
  return true
}

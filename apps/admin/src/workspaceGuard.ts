export function resolveNavigationGuard(
  path: string,
  accessToken: string,
  draftId: string,
): true | '/login' | '/workspace' {
  if (path === '/login') return true
  if (!accessToken) return '/login'
  if (path === '/workspace') return true
  if (!draftId) return '/workspace'
  return true
}

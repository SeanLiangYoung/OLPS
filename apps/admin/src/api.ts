import { clearSession, getAccessToken, setAccessToken } from './session'

export { getAccessToken, setAccessToken, clearSession }
export {
  getSelectedDraftId,
  setSelectedDraftId,
} from './session'

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { skipAuth?: boolean },
): Promise<T> {
  const headers: Record<string, string> = {}
  if (!opts?.skipAuth) {
    const token = getAccessToken()
    if (!token) throw new Error('尚未登录')
    headers.authorization = `Bearer ${token}`
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(text.slice(0, 200) || `HTTP ${res.status}`)
    }
  }
  if (!res.ok) {
    const err =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `${res.status} ${text.slice(0, 200)}`
    throw new Error(err)
  }
  return data as T
}

export async function logoutApi(): Promise<void> {
  const token = getAccessToken()
  if (token) {
    await api('POST', '/api/auth/logout')
  }
  clearSession()
}

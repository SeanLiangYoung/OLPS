import { clearSession, getAccessToken, setAccessToken } from './session'

export { getAccessToken, setAccessToken, clearSession }
export {
  getSelectedDraftId,
  setSelectedDraftId,
} from './session'

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) { super(message) }
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { skipAuth?: boolean; headers?: Record<string, string> },
): Promise<T> {
  const headers: Record<string, string> = { ...opts?.headers }
  if (!opts?.skipAuth) {
    const token = getAccessToken()
    if (!token) throw new Error('尚未登录')
    headers.authorization = `Bearer ${token}`
  }
  const multipart = body instanceof FormData
  const binary =
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof Blob !== 'undefined' && body instanceof Blob)
  if (body !== undefined && !multipart && !binary) headers['content-type'] = 'application/json'
  const res = await fetch(path, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : multipart || binary
          ? (body as BodyInit)
          : JSON.stringify(body),
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
    const structured = data && typeof data === 'object' ? data as { code?: string; details?: unknown } : undefined
    throw new ApiError(err, res.status, structured?.code, structured?.details)
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

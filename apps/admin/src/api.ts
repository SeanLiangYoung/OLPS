const TOKEN_KEY = 'olps_token'
const TENANT_KEY = 'olps_tenant'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getTenantId(): string {
  return localStorage.getItem(TENANT_KEY) ?? ''
}

export function setTenantId(tenantId: string): void {
  localStorage.setItem(TENANT_KEY, tenantId)
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { skipTenant?: boolean },
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${getToken()}`,
  }
  if (!opts?.skipTenant) {
    const tenantId = getTenantId()
    if (!tenantId) throw new Error('尚未选择租户')
    headers['x-tenant-id'] = tenantId
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(text.slice(0, 200) || `HTTP ${res.status}`)
    }
  }
  if (!res.ok) {
    throw new Error(data?.error ? String(data.error) : `${res.status} ${text.slice(0, 200)}`)
  }
  return data as T
}

/** 轮询 Job，直到 completed / failed，或超过次数上限。 */
export async function pollJob<T extends { status: string }>(
  jobId: string,
  opts?: { intervalMs?: number; maxAttempts?: number },
): Promise<T> {
  const intervalMs = opts?.intervalMs ?? 800
  const maxAttempts = opts?.maxAttempts ?? 60
  for (let i = 0; i < maxAttempts; i += 1) {
    const data = await api<{ job: T }>('GET', `/api/jobs/${jobId}`)
    const job = data.job
    if (job.status === 'completed' || job.status === 'failed') return job
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Job 超时未完成: ${jobId}`)
}

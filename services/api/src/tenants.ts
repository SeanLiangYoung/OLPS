import { appConfig } from './config.js'

export type AiSiteTenant = {
  tenantId: string
  name: string
  tenantCode?: string
}

type CacheEntry = {
  tenants: AiSiteTenant[]
  expiresAt: number
}

const listCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60_000

function readPositiveId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value.trim())) {
    return value.trim()
  }
  return undefined
}

function normalizeTenantItem(item: unknown): AiSiteTenant | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const tenantId = readPositiveId(record.id ?? record.Id)
  if (!tenantId) return null
  const nameRaw = record.name ?? record.Name
  const name =
    typeof nameRaw === 'string' && nameRaw.trim()
      ? nameRaw.trim()
      : `租户 ${tenantId}`
  const codeRaw = record.tenantCode ?? record.TenantCode
  return {
    tenantId,
    name,
    ...(typeof codeRaw === 'string' && codeRaw.trim()
      ? { tenantCode: codeRaw.trim() }
      : {}),
  }
}

function parseTenantListPayload(payload: unknown): AiSiteTenant[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : null
  if (!rows) {
    throw new Error('AI Sites 租户列表响应格式无效')
  }
  const tenants: AiSiteTenant[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const tenant = normalizeTenantItem(row)
    if (!tenant || seen.has(tenant.tenantId)) continue
    seen.add(tenant.tenantId)
    tenants.push(tenant)
  }
  return tenants
}

/** 用当前 SSO token 向 AI Sites 拉取该账号可见的租户。 */
export async function listAiSiteTenantsForToken(
  accessToken: string,
): Promise<AiSiteTenant[]> {
  const cached = listCache.get(accessToken)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tenants
  }

  const base = appConfig.siteApiInternalBaseUrl
  const response = await fetch(`${base}/api/v1/tenants`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(appConfig.siteApiRequestTimeoutMs),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      text.trim() || `AI Sites 租户列表请求失败 (${response.status})`,
    )
  }
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new Error('AI Sites 租户列表返回了非 JSON')
    }
  }
  const tenants = parseTenantListPayload(payload)
  listCache.set(accessToken, {
    tenants,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
  return tenants
}

export async function assertTokenCanAccessTenant(
  accessToken: string,
  tenantId: string,
): Promise<void> {
  const tenants = await listAiSiteTenantsForToken(accessToken)
  if (!tenants.some((tenant) => tenant.tenantId === tenantId)) {
    throw new Error('账号不属于该租户')
  }
}

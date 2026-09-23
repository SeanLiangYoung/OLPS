import type { Context, Next } from 'hono'
import { appConfig } from './config.js'
import { fetchUserInfo, SsoLoginError } from './sso/siluzan-login.js'

export type AuthContext = {
  accountId: string
  tenantId: string
  token: string
  name?: string
  email?: string
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext
  }
}

type CacheEntry = {
  accountId: string
  name?: string
  email?: string
  expiresAt: number
}

const userInfoCache = new Map<string, CacheEntry>()

export async function resolveAccountFromToken(token: string): Promise<{
  accountId: string
  name?: string
  email?: string
}> {
  const cached = userInfoCache.get(token)
  if (cached && cached.expiresAt > Date.now()) {
    return {
      accountId: cached.accountId,
      name: cached.name,
      email: cached.email,
    }
  }
  const info = await fetchUserInfo({
    authority: appConfig.ssoAuthority,
    accessToken: token,
  })
  userInfoCache.set(token, {
    accountId: info.sub,
    name: info.name,
    email: info.email,
    expiresAt: Date.now() + 60_000,
  })
  return { accountId: info.sub, name: info.name, email: info.email }
}

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const header = c.req.header('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = match[1]!.trim()
  const tenantId = c.req.header('x-tenant-id')?.trim()
  if (!tenantId) {
    return c.json({ error: '缺少 X-Tenant-Id' }, 400)
  }

  const account = await resolveAccountFromToken(token).catch((error) => {
    if (error instanceof SsoLoginError) return null
    throw error
  })
  if (!account) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('auth', {
    accountId: account.accountId,
    tenantId,
    token,
    name: account.name,
    email: account.email,
  })
  await next()
}

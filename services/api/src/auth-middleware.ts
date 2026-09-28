import type { Context, Next } from 'hono'
import type { UserRecord } from '@olps/domain'
import { resolveUserFromToken } from './sessions.js'

export type AuthVariables = {
  user: UserRecord
  accessToken: string
}

function parseBearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null
  }
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const token = parseBearer(c.req.header('Authorization'))
  if (!token) {
    return c.json({ error: '未登录' }, 401)
  }
  const user = await resolveUserFromToken(token)
  if (!user) {
    return c.json({ error: '会话无效或已过期' }, 401)
  }
  c.set('user', user)
  c.set('accessToken', token)
  await next()
}

export function getAuthUser(c: Context): UserRecord {
  return c.get('user') as UserRecord
}

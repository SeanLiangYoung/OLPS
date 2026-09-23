import { createHash, randomBytes } from 'node:crypto'

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_BODY_BYTES = 256 * 1024

export class SsoLoginError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message)
    this.name = 'SsoLoginError'
  }
}

export function normalizePhoneForSend(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits.replace(/^\+86/, '')
  if (digits.startsWith('86') && digits.length >= 13) return digits.slice(2)
  return digits.replace(/\D/g, '')
}

export function normalizePhoneForLogin(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  if (digits.startsWith('86') && digits.length >= 13) return `+${digits}`
  if (/^1\d{10}$/.test(digits)) return `+86${digits}`
  return `+${digits}`
}

function assertSecureAuthority(authority: string): string {
  const normalized = authority.trim().replace(/\/$/, '')
  if (!normalized) throw new SsoLoginError('SSO authority is required')
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new SsoLoginError('SSO authority is invalid')
  }
  const host = url.hostname.toLowerCase()
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')
  if (!isLocal && url.protocol !== 'https:') {
    throw new SsoLoginError('SSO authority 在非本机时必须使用 HTTPS')
  }
  return normalized
}

function looksLikeJwt(value: string): boolean {
  const token = value.trim()
  return token.split('.').length >= 3 && token.length > 40
}

export function pickAccessTokenFromLoginBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const root = body as Record<string, unknown>
  const candidates: unknown[] = [
    (root.token as Record<string, unknown> | undefined)?.accessToken,
    (root.token as Record<string, unknown> | undefined)?.access_token,
    (root.token as Record<string, unknown> | undefined)?.AccessToken,
    root.access_token,
    root.accessToken,
    (root.data as Record<string, unknown> | undefined)?.access_token,
    (root.data as Record<string, unknown> | undefined)?.accessToken,
  ]
  for (const raw of [root.token, (root.data as Record<string, unknown> | undefined)?.token]) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    candidates.push(trimmed)
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      candidates.push(parsed.accessToken, parsed.access_token, parsed.AccessToken)
    } catch {
      // 非 JSON 字符串仍可作为候选
    }
  }
  for (const value of candidates) {
    if (typeof value === 'string' && looksLikeJwt(value)) return value.trim()
  }
  return null
}

async function readJsonBodyLimited(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length > MAX_BODY_BYTES) throw new SsoLoginError('SSO response body too large')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SsoLoginError(`SSO response is not JSON (http ${response.status})`, response.status)
  }
}

export async function sendLoginCode(input: {
  authority: string
  phone: string
  timeoutMs?: number
}): Promise<void> {
  const authority = assertSecureAuthority(input.authority)
  const phone = normalizePhoneForSend(input.phone)
  if (!phone) throw new SsoLoginError('phone is required')
  const url = new URL(`${authority}/Account/SendVaildCode`)
  url.searchParams.set('phone', phone)
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  await readJsonBodyLimited(response)
  if (!response.ok) {
    throw new SsoLoginError(`发送验证码失败 (http ${response.status})`, response.status)
  }
}

export async function loginByMiniCode(input: {
  authority: string
  phone: string
  code: string
  key?: string
  timeoutMs?: number
}): Promise<{ accessToken: string }> {
  const authority = assertSecureAuthority(input.authority)
  const phone = normalizePhoneForLogin(input.phone)
  const code = input.code.trim()
  if (!phone) throw new SsoLoginError('phone is required')
  if (!code) throw new SsoLoginError('login code is required')
  const url = new URL(`${authority}/Account/LoginByMiniCode`)
  url.searchParams.set('phone', phone)
  url.searchParams.set('code', code)
  url.searchParams.set('key', input.key ?? '')
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  const body = await readJsonBodyLimited(response)
  if (!response.ok) {
    throw new SsoLoginError(`手机号登录失败 (http ${response.status})`, response.status)
  }
  const accessToken = pickAccessTokenFromLoginBody(body)
  if (!accessToken) {
    const message =
      body && typeof body === 'object' && typeof (body as { msg?: unknown }).msg === 'string'
        ? String((body as { msg: string }).msg)
        : '手机号登录响应缺少 access token'
    throw new SsoLoginError(message, 401)
  }
  return { accessToken }
}

const DEFAULT_PASSWORD_CLIENT_ID = 'cso_client'
const DEFAULT_PASSWORD_SCOPE = 'openid api-tso api-aisites api-google cutapi.rw'
const PHONE_PASSWORD_OIDC_CLIENT_ID = 'lps_cli'
const PHONE_PASSWORD_REDIRECT_URI = 'http://127.0.0.1/callback'
const PHONE_PASSWORD_OIDC_SCOPE =
  'openid profile email api-aisites api-tso api-google cutapi.rw'
const PASSWORD_LOGIN_USER_AGENT = 'Mozilla/5.0 OLPS-Admin'

export function looksLikePhoneAccount(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.includes('@')) return false
  return /^1\d{10}$/.test(normalizePhoneForSend(trimmed))
}

class CookieJar {
  private readonly cookies = new Map<string, string>()

  absorb(response: Response): void {
    const raw =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : []
    const lines = raw.length > 0 ? raw : [response.headers.get('set-cookie') ?? ''].filter(Boolean)
    for (const line of lines) {
      const [pair] = line.split(';')
      const eq = pair?.indexOf('=') ?? -1
      if (!pair || eq <= 0) continue
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1))
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  hasIdentitySession(): boolean {
    return this.cookies.has('idsrv')
  }
}

function extractAntiforgeryToken(html: string): string | undefined {
  return (
    html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1] ??
    html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/)?.[1]
  )
}

function readAuthorizeCode(location: string | null, authority: string): string | null {
  if (!location) return null
  try {
    return new URL(location, authority).searchParams.get('code')
  } catch {
    return null
  }
}

async function loginByPhonePassword(input: {
  authority: string
  account: string
  password: string
  timeoutMs?: number
}): Promise<{ accessToken: string }> {
  const authority = assertSecureAuthority(input.authority)
  const phone = normalizePhoneForSend(input.account)
  if (!phone) throw new SsoLoginError('account is required')
  if (!input.password) throw new SsoLoginError('password is required')
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const jar = new CookieJar()
  const loginUrl = `${authority}/account/login`

  const pageResponse = await fetch(loginUrl, {
    method: 'GET',
    headers: { Accept: 'text/html', 'User-Agent': PASSWORD_LOGIN_USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  })
  jar.absorb(pageResponse)
  const pageHtml = await pageResponse.text()
  if (pageHtml.length > MAX_BODY_BYTES) throw new SsoLoginError('SSO response body too large')
  const antiforgery = extractAntiforgeryToken(pageHtml)
  if (!pageResponse.ok || !antiforgery) throw new SsoLoginError('Password login failed', 503)

  const loginResponse = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: jar.header(),
      Origin: authority,
      Referer: loginUrl,
      'User-Agent': PASSWORD_LOGIN_USER_AGENT,
    },
    body: new URLSearchParams({
      __RequestVerificationToken: antiforgery,
      ReturnUrl: '',
      LoginType: 'Phone',
      Phone: phone,
      Password: input.password,
      AreaCode: '+86',
      DeviceId: 'olps-admin',
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  jar.absorb(loginResponse)
  if (!jar.hasIdentitySession() || (loginResponse.status !== 302 && loginResponse.status !== 303)) {
    throw new SsoLoginError('账号或密码不正确', 401)
  }

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const authorizeUrl = new URL(`${authority}/connect/authorize`)
  authorizeUrl.searchParams.set('client_id', PHONE_PASSWORD_OIDC_CLIENT_ID)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('redirect_uri', PHONE_PASSWORD_REDIRECT_URI)
  authorizeUrl.searchParams.set('scope', PHONE_PASSWORD_OIDC_SCOPE)
  authorizeUrl.searchParams.set('state', randomBytes(12).toString('base64url'))
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('nonce', randomBytes(12).toString('base64url'))

  const authorizeResponse = await fetch(authorizeUrl, {
    redirect: 'manual',
    headers: { Cookie: jar.header(), 'User-Agent': PASSWORD_LOGIN_USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const code = readAuthorizeCode(authorizeResponse.headers.get('location'), authority)
  if (!code) throw new SsoLoginError('账号或密码不正确', 401)

  const tokenResponse = await fetch(`${authority}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: PHONE_PASSWORD_REDIRECT_URI,
      client_id: PHONE_PASSWORD_OIDC_CLIENT_ID,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await readJsonBodyLimited(tokenResponse)
  if (!tokenResponse.ok) {
    throw new SsoLoginError(
      `Password login failed (http ${tokenResponse.status})`,
      tokenResponse.status === 400 || tokenResponse.status === 401 ? 401 : tokenResponse.status,
    )
  }
  const accessToken = pickAccessTokenFromLoginBody(body)
  if (!accessToken) throw new SsoLoginError('Password login response missing access token', 401)
  return { accessToken }
}

export async function loginByPassword(input: {
  authority: string
  account: string
  password: string
  clientId?: string
  clientSecret?: string
  scope?: string
  timeoutMs?: number
}): Promise<{ accessToken: string }> {
  const authority = assertSecureAuthority(input.authority)
  const account = input.account.trim()
  if (!account) throw new SsoLoginError('account is required')
  if (!input.password) throw new SsoLoginError('password is required')
  if (looksLikePhoneAccount(account)) {
    return loginByPhonePassword({
      authority,
      account,
      password: input.password,
      timeoutMs: input.timeoutMs,
    })
  }

  const params = new URLSearchParams({
    grant_type: 'password',
    username: account,
    password: input.password,
    client_id: input.clientId?.trim() || DEFAULT_PASSWORD_CLIENT_ID,
    scope: input.scope?.trim() || DEFAULT_PASSWORD_SCOPE,
  })
  const clientSecret = input.clientSecret?.trim()
  if (clientSecret) params.set('client_secret', clientSecret)

  const response = await fetch(`${authority}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  const body = await readJsonBodyLimited(response)
  if (!response.ok) {
    if (
      body &&
      typeof body === 'object' &&
      (body as { error?: string }).error === 'invalid_grant'
    ) {
      throw new SsoLoginError('账号或密码不正确', 401)
    }
    throw new SsoLoginError(`Password login failed (http ${response.status})`, response.status)
  }
  const accessToken = pickAccessTokenFromLoginBody(body)
  if (!accessToken) throw new SsoLoginError('Password login response missing access token', 401)
  return { accessToken }
}

export async function fetchUserInfo(input: {
  authority: string
  accessToken: string
  timeoutMs?: number
}): Promise<{ sub: string; name?: string; email?: string }> {
  const authority = assertSecureAuthority(input.authority)
  const response = await fetch(`${authority}/connect/userinfo`, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  const body = await readJsonBodyLimited(response)
  if (!response.ok) {
    throw new SsoLoginError(`userinfo 失败 (http ${response.status})`, response.status)
  }
  if (!body || typeof body !== 'object') throw new SsoLoginError('userinfo 响应无效', 401)
  const sub = String((body as { sub?: unknown }).sub ?? '').trim()
  if (!sub) throw new SsoLoginError('userinfo 缺少 sub', 401)
  const name =
    typeof (body as { name?: unknown }).name === 'string'
      ? String((body as { name: string }).name)
      : undefined
  const email =
    typeof (body as { email?: unknown }).email === 'string'
      ? String((body as { email: string }).email)
      : undefined
  return { sub, name, email }
}

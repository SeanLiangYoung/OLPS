import type { Hono } from 'hono'

export async function requestJson(
  app: Hono,
  method: string,
  path: string,
  options: {
    token?: string
    body?: unknown
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }
  const response = await app.request(path, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  let body: Record<string, unknown> = {}
  if (text.trim()) {
    body = JSON.parse(text) as Record<string, unknown>
  }
  return { status: response.status, body }
}

export async function registerUser(
  app: Hono,
  input: { account: string; password: string; name: string },
): Promise<{ status: number; accessToken: string; user: Record<string, unknown> }> {
  const { status, body } = await requestJson(app, 'POST', '/api/auth/register', { body: input })
  return {
    status,
    accessToken: String(body.accessToken ?? ''),
    user: (body.user as Record<string, unknown>) ?? {},
  }
}

export async function loginUser(
  app: Hono,
  input: { account: string; password: string },
): Promise<{ status: number; accessToken: string; user: Record<string, unknown> }> {
  const { status, body } = await requestJson(app, 'POST', '/api/auth/login', { body: input })
  return {
    status,
    accessToken: String(body.accessToken ?? ''),
    user: (body.user as Record<string, unknown>) ?? {},
  }
}

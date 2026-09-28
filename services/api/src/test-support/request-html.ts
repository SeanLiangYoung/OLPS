import type { Env, Hono } from 'hono'

export async function requestHtml<E extends Env>(
  app: Hono<E>,
  method: string,
  path: string,
  options: {
    token?: string
    headers?: Record<string, string>
  } = {},
): Promise<{ status: number; text: string; contentType: string | null }> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }
  const response = await app.request(path, { method, headers })
  return {
    status: response.status,
    text: await response.text(),
    contentType: response.headers.get('content-type'),
  }
}

export function previewAssetPath(previewUrl: string, relativePath: string): string {
  const normalized = relativePath.replace(/^\.\//, '')
  const base = previewUrl.endsWith('/') ? previewUrl : `${previewUrl}/`
  return `${base}${normalized}`
}

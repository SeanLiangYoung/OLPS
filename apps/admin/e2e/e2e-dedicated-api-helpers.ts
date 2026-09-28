import type { Page } from '@playwright/test'

export async function readOlpsAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('olps_access_token'))
  if (!token) {
    throw new Error('Admin 未登录，localStorage 中无 olps_access_token')
  }
  return token
}

export function draftIdFromPageUrl(pageUrl: string): string {
  const match = pageUrl.match(/\/drafts\/([^/]+)\/pages\//)
  if (!match?.[1]) {
    throw new Error(`页面 URL 中未解析到 draftId: ${pageUrl}`)
  }
  return match[1]
}

export function pageIdFromPageUrl(pageUrl: string): string {
  const match = pageUrl.match(/\/drafts\/[^/]+\/pages\/([^/?#]+)/)
  if (!match?.[1]) {
    throw new Error(`页面 URL 中未解析到 pageId: ${pageUrl}`)
  }
  return match[1]
}

async function apiJson(
  apiBaseUrl: string,
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const base = apiBaseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  if (text) {
    parsed = JSON.parse(text) as Record<string, unknown>
  }
  return { status: res.status, body: parsed }
}

/** 远端领先于 sandbox：先 Push 远端内容，再把 sandbox 改回旧内容且不 Push。 */
export async function setSandboxBehindPublishedRemote(input: {
  apiBaseUrl: string
  accessToken: string
  draftId: string
  pageId: string
  remoteHtml: string
  localHtml: string
}): Promise<void> {
  const patchRemote = await apiJson(
    input.apiBaseUrl,
    input.accessToken,
    'PATCH',
    `/api/drafts/${input.draftId}/pages/${input.pageId}`,
    { body: { html: input.remoteHtml } },
  )
  if (patchRemote.status !== 200) {
    throw new Error(`PATCH 远端内容失败: HTTP ${patchRemote.status} ${JSON.stringify(patchRemote.body)}`)
  }
  const pushRemote = await apiJson(
    input.apiBaseUrl,
    input.accessToken,
    'POST',
    `/api/drafts/${input.draftId}/push`,
  )
  if (pushRemote.status !== 200) {
    throw new Error(`Push 远端内容失败: HTTP ${pushRemote.status} ${JSON.stringify(pushRemote.body)}`)
  }
  const patchLocal = await apiJson(
    input.apiBaseUrl,
    input.accessToken,
    'PATCH',
    `/api/drafts/${input.draftId}/pages/${input.pageId}`,
    { body: { html: input.localHtml } },
  )
  if (patchLocal.status !== 200) {
    throw new Error(`PATCH 本地旧内容失败: HTTP ${patchLocal.status} ${JSON.stringify(patchLocal.body)}`)
  }
}

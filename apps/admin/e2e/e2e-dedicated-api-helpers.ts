import { expect, type Page } from '@playwright/test'

const OLPS_ACCESS_TOKEN_KEY = 'olps_access_token'

export function dedicatedAdminOrigin(adminBaseUrl: string): string {
  return new URL(adminBaseUrl).origin
}

export async function assertPageOnDedicatedAdmin(page: Page, adminBaseUrl: string): Promise<void> {
  expect(new URL(page.url()).origin).toBe(dedicatedAdminOrigin(adminBaseUrl))
}

export async function registerOnDedicatedAdminLogin(
  page: Page,
  adminBaseUrl: string,
  user: { name: string; account: string; password: string },
): Promise<void> {
  await page.goto(`${adminBaseUrl.replace(/\/+$/, '')}/login`)
  await assertPageOnDedicatedAdmin(page, adminBaseUrl)
  await page.getByRole('tab', { name: '注册' }).click()
  await page.locator('#reg-name').fill(user.name)
  await page.locator('#reg-account').fill(user.account)
  await page.locator('#reg-password').fill(user.password)
  await page.getByRole('button', { name: '注册并进入' }).click()
  await expect(page).toHaveURL(/\/workspace/)
  await assertPageOnDedicatedAdmin(page, adminBaseUrl)
}

export async function readOlpsAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(
    (key) => localStorage.getItem(key),
    OLPS_ACCESS_TOKEN_KEY,
  )
  if (!token) {
    throw new Error(`Admin 未登录，localStorage 中无 ${OLPS_ACCESS_TOKEN_KEY}`)
  }
  return token
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

/** 草稿 A 已发布 V1 后，在 A 上修改并 Push V2，远端领先于基于 V1 创建的草稿 B。 */
export async function pushPublishedV2OnDraftA(input: {
  apiBaseUrl: string
  accessToken: string
  draftAId: string
  pageId: string
  v2Html: string
}): Promise<void> {
  const patch = await apiJson(
    input.apiBaseUrl,
    input.accessToken,
    'PATCH',
    `/api/drafts/${input.draftAId}/pages/${input.pageId}`,
    { body: { html: input.v2Html } },
  )
  if (patch.status !== 200) {
    throw new Error(`草稿 A PATCH V2 失败: HTTP ${patch.status} ${JSON.stringify(patch.body)}`)
  }
  const push = await apiJson(
    input.apiBaseUrl,
    input.accessToken,
    'POST',
    `/api/drafts/${input.draftAId}/push`,
  )
  if (push.status !== 200) {
    throw new Error(`草稿 A Push V2 失败: HTTP ${push.status} ${JSON.stringify(push.body)}`)
  }
}

export async function fetchDraftPageHtml(input: {
  apiBaseUrl: string
  accessToken: string
  draftId: string
  pageId: string
}): Promise<string> {
  const read = await apiJson(
    input.apiBaseUrl,
    input.accessToken,
    'GET',
    `/api/drafts/${input.draftId}/pages/${input.pageId}`,
  )
  if (read.status !== 200) {
    throw new Error(`GET page 失败: HTTP ${read.status} ${JSON.stringify(read.body)}`)
  }
  const page = read.body.page as { body?: { html?: string } } | undefined
  return typeof page?.body?.html === 'string' ? page.body.html : ''
}

export async function fetchDraftPageIdBySlug(input: {
  apiBaseUrl: string
  accessToken: string
  draftId: string
  slug: string
}): Promise<string> {
  const listed = await apiJson(
    input.apiBaseUrl,
    input.accessToken,
    'GET',
    `/api/drafts/${input.draftId}/pages`,
  )
  if (listed.status !== 200) {
    throw new Error(`GET pages 失败: HTTP ${listed.status} ${JSON.stringify(listed.body)}`)
  }
  const pages = listed.body.pages as Array<{ slug?: string; pageId?: string }> | undefined
  const page = pages?.find((p) => p.slug === input.slug)
  if (!page?.pageId) {
    throw new Error(`草稿 ${input.draftId} 中未找到 slug=${input.slug} 的页面`)
  }
  return String(page.pageId)
}

import { expect, type Page } from '@playwright/test'
import { apiBase } from './helpers'

/** 与 packages/site-builder/src/inquiry-runtime.ts 成功文案一致 */
export const INQUIRY_SUBMITTED_STATUS = 'Submitted'

/** 与 packages/site-builder/src/inquiry.ts buildInquiryApiPath 一致（publicApiBaseUrl 使用 OLPS_API_URL） */
export function expectedInquiryPostUrl(siteId: string, pageId: string): string {
  const base = apiBase.replace(/\/+$/, '')
  return `${base}/api/public/${encodeURIComponent(siteId)}/inquiries?pageId=${encodeURIComponent(pageId)}`
}

export function pageIdFromAdminDetailUrl(url: string): string {
  const match = url.match(/\/drafts\/[^/]+\/pages\/([^/?#]+)/)
  if (!match?.[1]) {
    throw new Error(`无法从 Admin 页面 URL 解析 pageId：${url}`)
  }
  return match[1]
}

export function draftIdFromAdminDetailUrl(url: string): string {
  const match = url.match(/\/drafts\/([^/]+)\/pages\//)
  if (!match?.[1]) {
    throw new Error(`无法从 Admin 页面 URL 解析 draftId：${url}`)
  }
  return match[1]
}

export async function readAccessTokenFromAdmin(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('olps_access_token'))
  if (!token) {
    throw new Error('Admin 未登录，localStorage 中无 olps_access_token')
  }
  return token
}

export async function adminAuthedJson<T>(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await readAccessTokenFromAdmin(page)
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Admin API ${method} ${path} 返回 HTTP ${res.status}：${text}`)
  }
  return (await res.json()) as T
}

export async function fetchDraftLinkedSiteId(page: Page, draftId: string): Promise<string> {
  const data = await adminAuthedJson<{ draft: { siteId: string | null } }>(
    page,
    'GET',
    `/api/drafts/${draftId}`,
  )
  const siteId = data.draft.siteId
  if (!siteId) {
    throw new Error(`草稿 ${draftId} 尚未关联 siteId，请先 Push 发布`)
  }
  return siteId
}

/** 仅表单 markup；发布时 @olps/site-builder 注入 inquiry-runtime.ts */
export function siteInquiryFormMarkup(submitLabel = 'Send inquiry'): string {
  return `<section>
<h1>Inquiry</h1>
<form data-olps-inquiry>
  <label>Name <input name="name" required /></label>
  <label>Email <input name="email" type="email" required /></label>
  <label>Message <textarea name="message" required /></label>
  <button type="submit">${submitLabel}</button>
  <p data-olps-inquiry-status role="status"></p>
</form>
</section>`
}

export async function fetchDraftPagePublicUrls(
  page: Page,
  draftId: string,
  pageId: string,
): Promise<string[]> {
  const data = await adminAuthedJson<{ page: { publicUrls?: string[] } }>(
    page,
    'GET',
    `/api/drafts/${draftId}/pages/${pageId}`,
  )
  const urls = data.page.publicUrls ?? []
  if (urls.length === 0) {
    throw new Error(`页面 ${pageId} 尚无 publicUrls，请确认 Push 已完成`)
  }
  return urls
}

export function pickSitePagePublicUrl(publicUrls: string[]): string {
  const siteUrls = publicUrls.filter((u) => !new URL(u).pathname.includes('--'))
  if (siteUrls.length === 1) {
    return siteUrls[0]!
  }
  if (publicUrls.length === 1) {
    return publicUrls[0]!
  }
  throw new Error(`无法从 publicUrls 选定通用站页 URL：${publicUrls.join(', ')}`)
}

/** 广告词路由 URL 来自 Push 后 API 返回的 publicUrls，按 pathname 排序取首条（与 keywordCluster 顺序一致） */
export function pickFirstAdsKeywordPublicUrl(publicUrls: string[], pageSlug: string): string {
  const adsUrls = publicUrls
    .filter((u) => new URL(u).pathname.includes(`/${pageSlug}--`))
    .sort((a, b) => a.localeCompare(b))
  if (!adsUrls[0]) {
    throw new Error(`publicUrls 中无广告词路由（slug=${pageSlug}）：${publicUrls.join(', ')}`)
  }
  return adsUrls[0]
}

export function buildMinimalAdsPagePatch(input: {
  title: string
  slug: string
  keywordA: string
  keywordB: string
}): {
  title: string
  seo: { title: string; description: string }
  body: {
    html: string
    ads: {
      keywordCluster: string[]
      screens: Array<{
        screenId: string
        role: string
        title: string
        html: string
        entryFor?: string[]
      }>
      guide: {
        entryByKeyword: Record<string, string>
        nodes: Record<
          string,
          {
            options: Array<{
              id: string
              label: string
              action: string
              targetScreenId?: string
            }>
          }
        >
      }
    }
  }
} {
  const description = `E2E ads ${input.slug}`
  const html = `<!doctype html><html><head><title>${input.title}</title></head><body><div id="olps-ads-root"></div></body></html>`
  const ctaHtml = `<form data-olps-inquiry>
  <label>Name <input name="name" required /></label>
  <label>Email <input name="email" type="email" required /></label>
  <label>Message <textarea name="message" required /></label>
  <button type="submit">Send ads</button>
  <p data-olps-inquiry-status role="status"></p>
</form>`
  return {
    title: input.title,
    seo: { title: input.title, description },
    body: {
      html,
      ads: {
        keywordCluster: [input.keywordA, input.keywordB],
        screens: [
          {
            screenId: 'entry-a',
            role: 'entry',
            title: input.keywordA,
            html: `<p>${input.keywordA}</p>`,
            entryFor: [input.keywordA],
          },
          {
            screenId: 'entry-b',
            role: 'entry',
            title: input.keywordB,
            html: `<p>${input.keywordB}</p>`,
            entryFor: [input.keywordB],
          },
          {
            screenId: 'cta',
            role: 'cta',
            title: 'Inquiry',
            html: ctaHtml,
          },
        ],
        guide: {
          entryByKeyword: {
            [input.keywordA]: 'entry-a',
            [input.keywordB]: 'entry-b',
          },
          nodes: {
            'entry-a': {
              options: [{ id: 'to-cta', label: 'Go', action: 'go_cta' }],
            },
            'entry-b': {
              options: [{ id: 'to-cta-b', label: 'Go', action: 'go_cta' }],
            },
            cta: { options: [] },
          },
        },
      },
    },
  }
}

export async function patchDraftPage(
  page: Page,
  draftId: string,
  pageId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await adminAuthedJson(page, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, patch)
}

export async function createAdsPageAndOpen(
  page: Page,
  input: { title: string; slug: string; keywordA: string; keywordB: string },
): Promise<{ draftId: string; pageId: string; pageSlug: string }> {
  await page.getByRole('link', { name: '页面' }).click()
  await page.locator('label:has-text("类型") select').selectOption('ads')
  await page.locator('label:has-text("标题") input').fill(input.title)
  await page.locator('label:has-text("slug") input').fill(input.slug)
  await page.getByRole('button', { name: '创建并打开' }).click()
  await expect(page).toHaveURL(/\/drafts\/[^/]+\/pages\//)
  const draftId = draftIdFromAdminDetailUrl(page.url())
  const pageId = pageIdFromAdminDetailUrl(page.url())
  await patchDraftPage(page, draftId, pageId, buildMinimalAdsPagePatch(input))
  await page.reload()
  await expect(page.locator('h1')).toContainText(input.title)
  return { draftId, pageId, pageSlug: input.slug }
}

export type InquirySubmitPayload = {
  name: string
  email: string
  message: string
}

export async function submitPublicInquiryForm(
  publicPage: Page,
  siteId: string,
  pageId: string,
  payload: InquirySubmitPayload,
  submitButtonName: string,
): Promise<{ postUrl: string; postBody: Record<string, unknown> }> {
  const urlBefore = publicPage.url()
  const responseWait = publicPage.waitForResponse(
    (r) => r.url().includes('/inquiries') && r.request().method() === 'POST',
    { timeout: 90_000 },
  )
  await publicPage.locator('form[data-olps-inquiry] input[name="name"]').fill(payload.name)
  await publicPage.locator('form[data-olps-inquiry] input[name="email"]').fill(payload.email)
  await publicPage.locator('form[data-olps-inquiry] textarea[name="message"]').fill(payload.message)
  await publicPage.getByRole('button', { name: submitButtonName }).click()
  const res = await responseWait
  expect(publicPage.url()).toBe(urlBefore)
  const postUrl = res.request().url()
  expect(postUrl).toBe(expectedInquiryPostUrl(siteId, pageId))
  const postBody = res.request().postDataJSON() as Record<string, unknown>
  return { postUrl, postBody }
}

export async function expectInquiryVisibleInAdmin(
  adminPage: Page,
  siteId: string,
  pageId: string,
  payload: InquirySubmitPayload,
): Promise<number> {
  const listPath = `/api/sites/${siteId}/inquiries`
  const listWait = adminPage.waitForResponse(
    (r) => r.url().includes(listPath) && r.request().method() === 'GET',
    { timeout: 90_000 },
  )
  await adminPage.getByRole('link', { name: '询盘' }).click()
  const listRes = await listWait
  expect(listRes.status()).toBe(200)
  await expect(adminPage.locator('section.panel p.error')).toHaveCount(0)

  const data = await adminAuthedJson<{
    inquiries: Array<{
      inquiryId: number
      pageId: string | null
      payload: Record<string, unknown>
    }>
  }>(adminPage, 'GET', listPath)
  const match = (data.inquiries ?? []).find(
    (row) =>
      row.pageId === pageId &&
      row.payload?.name === payload.name &&
      row.payload?.email === payload.email &&
      row.payload?.message === payload.message,
  )
  if (!match) {
    throw new Error(
      `Admin/API 未找到 pageId=${pageId} 且 payload 匹配的询盘（共 ${data.inquiries?.length ?? 0} 条）`,
    )
  }

  const row = adminPage.locator('table.table tbody tr').filter({ hasText: pageId })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: '查看' }).click()
  await expect(adminPage.locator('pre')).toContainText(payload.message)
  return match.inquiryId
}

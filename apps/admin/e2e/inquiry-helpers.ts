import { expect, type Page } from '@playwright/test'
import { apiBase } from './helpers'

/** 与 services/api publish.slugifyKeyword 一致，用于拼广告词落地 URL。 */
export function slugifyKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function publicInquiryApiPath(tenantId: string, siteId: string, pageId: string): string {
  return `/api/public/${tenantId}/${siteId}/inquiries?pageId=${encodeURIComponent(pageId)}`
}

export function adsKeywordPublicUrl(
  sitePublicUrl: string,
  pageSlug: string,
  keyword: string,
): string {
  const base = sitePublicUrl.replace(/\/$/, '')
  return `${base}/${pageSlug}--${slugifyKeyword(keyword)}/`
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

export async function fetchPrimaryTenantId(page: Page): Promise<string> {
  const data = await adminAuthedJson<{ tenants: string[] }>(page, 'GET', '/api/auth/tenants')
  const tenantId = data.tenants?.[0]
  if (!tenantId) {
    throw new Error('GET /api/auth/tenants 未返回可用 tenantId')
  }
  return tenantId
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

/**
 * 通用站页 HTML：含 data-olps-inquiry 表单与 fetch POST（preventDefault），
 * 行为与 services/api ads-runtime 中 CTA 提交一致，供未注入 ads 运行时的 site 页使用。
 */
export function buildSitePageHtmlWithInquiry(inquiryApiPath: string, heading: string): string {
  const pathLiteral = JSON.stringify(inquiryApiPath)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${heading}</title>
</head>
<body>
  <main>
    <h1>${heading}</h1>
    <form data-olps-inquiry>
      <label>Name <input name="name" required /></label>
      <label>Email <input name="email" type="email" required /></label>
      <label>Message <textarea name="message" required></textarea></label>
      <button type="submit">Submit inquiry</button>
      <p data-olps-inquiry-status role="status"></p>
    </form>
  </main>
  <script>
(() => {
  const form = document.querySelector('[data-olps-inquiry]');
  if (!form) return;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    const status = form.querySelector('[data-olps-inquiry-status]');
    try {
      const res = await fetch(${pathLiteral}, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('inquiry failed');
      if (status) status.textContent = 'Submitted';
    } catch {
      if (status) status.textContent = 'Submit failed';
    }
  });
})();
  </script>
</body>
</html>`
}

type MinimalAdsInput = {
  title: string
  slug: string
  keywordA: string
  keywordB: string
}

/** 最小合法 ads 页 body，CTA 屏含 data-olps-inquiry（发布后会注入 ads 运行时）。 */
export function buildMinimalAdsPagePatch(input: MinimalAdsInput): {
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
  const ctaHtml = `<h2>Inquiry</h2>
<form data-olps-inquiry>
  <label>Name <input name="name" required /></label>
  <label>Email <input name="email" type="email" required /></label>
  <label>Message <textarea name="message" required /></label>
  <button type="submit">Submit</button>
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
              options: [{ id: 'to-cta', label: 'Inquire now', action: 'go_cta' }],
            },
            'entry-b': {
              options: [{ id: 'to-cta-b', label: 'Inquire now', action: 'go_cta' }],
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
): Promise<{ draftId: string; pageId: string }> {
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
  return { draftId, pageId }
}

export type InquirySubmitPayload = {
  name: string
  email: string
  message: string
}

export async function submitPublicInquiryForm(
  publicPage: Page,
  payload: InquirySubmitPayload,
): Promise<{ postUrl: string; postBody: Record<string, unknown>; pageIdFromQuery: string }> {
  const urlBefore = publicPage.url()
  const postWait = publicPage.waitForRequest(
    (req) => req.method() === 'POST' && req.url().includes('/inquiries'),
    { timeout: 90_000 },
  )
  await publicPage.locator('form[data-olps-inquiry] input[name="name"]').fill(payload.name)
  await publicPage.locator('form[data-olps-inquiry] input[name="email"]').fill(payload.email)
  await publicPage.locator('form[data-olps-inquiry] textarea[name="message"]').fill(payload.message)
  await publicPage.locator('form[data-olps-inquiry] button[type="submit"]').click()
  const postReq = await postWait
  expect(publicPage.url()).toBe(urlBefore)
  const postUrl = postReq.url()
  const parsed = new URL(postUrl)
  const pageIdFromQuery = parsed.searchParams.get('pageId') ?? ''
  if (!pageIdFromQuery) {
    throw new Error(`询盘 POST URL 缺少 pageId 查询参数：${postUrl}`)
  }
  const postBody = postReq.postDataJSON() as Record<string, unknown>
  return { postUrl, postBody, pageIdFromQuery }
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

  const data = await adminAuthedJson<{ inquiries: Array<{ inquiryId: number; pageId: string | null; payload: Record<string, unknown> }> }>(
    adminPage,
    'GET',
    listPath,
  )
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

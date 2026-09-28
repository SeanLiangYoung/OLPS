import { expect, type Page } from '@playwright/test'

export const apiBase = process.env.OLPS_API_URL ?? 'http://127.0.0.1:8787'

export async function requireApiReady(): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${apiBase}/api/health`)
  } catch {
    throw new Error(
      `无法连接管理 API（${apiBase}）。请先启动 api、remote 与 PostgreSQL（测试库见 codex-review.md）后再运行 npm run test:e2e -w @olps/admin。`,
    )
  }
  if (!res.ok) {
    throw new Error(
      `管理 API 未就绪（${apiBase}/api/health 返回 ${res.status}）。请先启动 api、remote 与 PostgreSQL 后再运行 e2e。`,
    )
  }
}

export type E2eUser = { account: string; password: string; name: string }

/** 顶栏 nav 链接（精确文案，避免与页面标题等子串误匹配） */
export function adminNavLink(page: Page, linkText: string) {
  return page.locator('header.top nav').getByRole('link', { name: linkText, exact: true })
}

export async function clickAdminNav(page: Page, linkText: string): Promise<void> {
  await adminNavLink(page, linkText).click()
}

export async function registerAndEnterWorkspace(page: Page, user: E2eUser): Promise<void> {
  await page.goto('/login')
  await page.getByRole('tab', { name: '注册' }).click()
  await page.locator('#reg-name').fill(user.name)
  await page.locator('#reg-account').fill(user.account)
  await page.locator('#reg-password').fill(user.password)
  await page.getByRole('button', { name: '注册并进入' }).click()
  await expect(page).toHaveURL(/\/workspace/)
}

export async function createDraftOnWorkspace(
  page: Page,
  draftName: string,
  options?: { basedOnSiteName?: string },
): Promise<{ draftId: string }> {
  await page.getByPlaceholder('例如：春季活动站').fill(draftName)
  if (options?.basedOnSiteName) {
    await page.getByLabel('基于已发布网站（可选）').selectOption({ label: options.basedOnSiteName })
  }
  const createWait = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname.replace(/\/$/, '') === '/api/drafts',
    { timeout: 180_000 },
  )
  await page.getByRole('button', { name: '创建草稿' }).click()
  const createRes = await createWait
  if (createRes.status() !== 201) {
    const body = await createRes.text()
    throw new Error(`创建草稿 POST 返回 HTTP ${createRes.status()}：${body}`)
  }
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 })
  const createBody = (await createRes.json()) as { draft?: { draftId?: string } }
  const draftId = createBody.draft?.draftId
  if (!draftId) {
    throw new Error(`创建草稿响应缺少 draftId：${JSON.stringify(createBody)}`)
  }
  return { draftId: String(draftId) }
}

export async function createSitePageAndOpen(
  page: Page,
  input: { title: string; slug: string },
): Promise<{ pageId: string; draftId: string }> {
  await clickAdminNav(page, '页面')
  await page.locator('label:has-text("标题") input').fill(input.title)
  await page.locator('label:has-text("slug") input').fill(input.slug)
  const createWait = page.waitForResponse(
    (r) => {
      if (r.request().method() !== 'POST') return false
      const path = new URL(r.url()).pathname.replace(/\/$/, '')
      return /^\/api\/drafts\/[^/]+\/pages$/.test(path)
    },
    { timeout: 180_000 },
  )
  await page.getByRole('button', { name: '创建并打开' }).click()
  const createRes = await createWait
  if (createRes.status() !== 201) {
    const body = await createRes.text()
    throw new Error(`创建页面 POST 返回 HTTP ${createRes.status()}：${body}`)
  }
  await expect(page).toHaveURL(/\/drafts\/[^/]+\/pages\//, { timeout: 60_000 })
  const createBody = (await createRes.json()) as { page?: { pageId?: string } }
  const pageId = createBody.page?.pageId
  if (!pageId) {
    throw new Error(`创建页面响应缺少 pageId：${JSON.stringify(createBody)}`)
  }
  const pageUrl = page.url()
  const draftMatch = pageUrl.match(/\/drafts\/([^/]+)\/pages\//)
  const draftId = draftMatch?.[1]
  if (!draftId) {
    throw new Error(`页面 URL 中未解析到 draftId: ${pageUrl}`)
  }
  return { pageId: String(pageId), draftId }
}

export async function setPageBodyHtml(page: Page, html: string): Promise<void> {
  await page.locator('label:has-text("body.html") textarea').fill(html)
}

export async function setPageSeoDescription(page: Page, text: string): Promise<void> {
  await page.locator('label:has-text("SEO description") textarea').fill(text)
}

export async function savePageDetail(page: Page): Promise<void> {
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存')).toBeVisible()
}

export async function runPushExpectPublished(
  page: Page,
): Promise<{ publicSiteUrl: string; siteName: string }> {
  await clickAdminNav(page, '发布与同步')
  await page.getByRole('button', { name: 'Push 并发布' }).click()
  const okLine = page.locator('p.ok')
  await expect(okLine).toContainText('Push 成功，线上地址：', { timeout: 90_000 })
  const text = (await okLine.textContent()) ?? ''
  const match = text.match(/Push 成功，线上地址：(\S+)/)
  if (!match?.[1]) {
    throw new Error(`Push 成功文案中未解析到 publicUrl：${text}`)
  }
  const publicSiteUrl = match[1].replace(/[.,;]$/, '')
  const siteBlock = page.locator('div.panel').filter({
    has: page.getByRole('heading', { name: '线上网站' }),
  })
  await expect(siteBlock).toBeVisible()
  const siteNameRaw = (await siteBlock.locator('p').first().textContent()) ?? ''
  const siteName = siteNameRaw.replace(/\s*版本[\s\S]*/u, '').trim()
  if (!siteName) {
    throw new Error('Push 成功后未在发布页读取到线上网站名称')
  }
  return { publicSiteUrl, siteName }
}

export async function runPullExpectComplete(page: Page): Promise<void> {
  await clickAdminNav(page, '发布与同步')
  await page.getByRole('button', { name: 'Pull 远端版本' }).click()
  await expect(page.locator('p.ok')).toContainText('Pull 已完成，sandbox 已更新', {
    timeout: 90_000,
  })
}

export async function addSiteOwnerOnWorkspace(
  page: Page,
  siteName: string,
  ownerAccount: string,
): Promise<void> {
  await page.goto('/workspace')
  const siteRow = page.locator('li').filter({ hasText: siteName })
  await siteRow.getByRole('button', { name: '管理网站所有者' }).click()
  await siteRow.getByPlaceholder('已有用户账号').fill(ownerAccount)
  await siteRow.getByRole('button', { name: '添加所有者' }).click()
  await expect(siteRow.getByText('已添加所有者')).toBeVisible()
}

export async function fetchPublicDocument(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`远端页面 GET 失败：${url} 返回 HTTP ${res.status}`)
  }
  return res.text()
}

export function pagePublicUrl(sitePublicUrl: string, slug: string): string {
  const base = sitePublicUrl.replace(/\/$/, '')
  return `${base}/${slug}/`
}

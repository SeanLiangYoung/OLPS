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

export function adminNavLink(page: Page, linkText: string) {
  const names: Record<string, string> = { 页面: '页面管理', 总览: '网站概况', 报告: '统计与报告', '广告/分析': '广告与分析', 设置: '网站设置', 询盘: '客户询盘', '发布与同步': '发布记录与协作' }
  return page.getByRole('navigation', { name: '网站管理导航' }).getByRole('link', { name: names[linkText] ?? linkText, exact: true })
}

export async function clickAdminNav(page: Page, linkText: string): Promise<void> {
  if (linkText === '生成') {
    await adminNavLink(page, '页面').click()
    await page.getByRole('link', { name: 'AI 生成页面', exact: true }).click()
    return
  }
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
    await page.getByLabel('已有网站（可选）').selectOption({ label: options.basedOnSiteName })
  }
  const createWait = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname.replace(/\/$/, '') === '/api/drafts',
    { timeout: 180_000 },
  )
  await page.getByRole('button', { name: options?.basedOnSiteName ? '创建编辑版本' : '创建网站', exact: true }).click()
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
  await page.getByRole('button', { name: '新增页面', exact: true }).click()
  const form = page.getByRole('region', { name: '新增页面' })
  await form.getByLabel('标题', { exact: true }).fill(input.title)
  await form.getByLabel('页面地址', { exact: true }).fill(input.slug)
  const createWait = page.waitForResponse(
    (r) => {
      if (r.request().method() !== 'POST') return false
      const path = new URL(r.url()).pathname.replace(/\/$/, '')
      return /^\/api\/drafts\/[^/]+\/pages$/.test(path)
    },
    { timeout: 180_000 },
  )
  await form.getByRole('button', { name: '创建并编辑' }).click()
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
  await openDetailSection(page, '高级 HTML 正文')
  await page.locator('label:has-text("body.html") textarea').fill(html)
}

export async function openDetailSection(page: Page, title: string): Promise<void> {
  const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: title }) }).first()
  if (!(await details.evaluate(element => (element as HTMLDetailsElement).open))) await details.locator('summary').first().click()
}

export async function setPageSeoDescription(page: Page, text: string): Promise<void> {
  await openDetailSection(page, '页面信息与 SEO')
  await page.locator('label:has-text("SEO description") textarea').fill(text)
}

export async function savePageDetail(page: Page): Promise<void> {
  await page.getByRole('button', { name: '保存页面', exact: true }).click()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
}

export async function runPushExpectPublished(
  page: Page,
): Promise<{ publicSiteUrl: string; siteName: string }> {
  await preparePublication(page)
  const responseWait = page.waitForResponse(response => response.request().method() === 'POST' && /\/publication\/confirm$/.test(new URL(response.url()).pathname), { timeout: 180_000 })
  await page.getByRole('button', { name: '确认发布', exact: true }).click()
  const response = await responseWait
  expect(response.status(), await response.text()).toBe(200)
  const siteBlock = page.locator('section.panel').filter({
    has: page.getByRole('heading', { name: '线上网站' }),
  })
  await expect(siteBlock).toBeVisible()
  const publicSiteUrl = await siteBlock.getByRole('link').getAttribute('href')
  if (!publicSiteUrl) throw new Error('发布结果缺少公开地址')
  const siteName = ((await siteBlock.locator('p').first().textContent()) ?? '').trim()
  if (!siteName) {
    throw new Error('Push 成功后未在发布页读取到线上网站名称')
  }
  return { publicSiteUrl, siteName }
}

export async function preparePublication(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '确认发布范围' })
  if (await dialog.count()) await dialog.getByRole('button', { name: '返回编辑', exact: true }).click()
  await clickAdminNav(page, '发布与同步')
  await page.getByLabel('选择全部待发布页面', { exact: true }).check()
  const settings = page.getByLabel('发布网站共用设置', { exact: true })
  if (await settings.count()) await settings.check()
  await page.getByRole('button', { name: '发布所选页面', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '确认发布范围' })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeEnabled()
}

export async function runPullExpectComplete(page: Page): Promise<void> {
  await clickAdminNav(page, '发布与同步')
  await openDetailSection(page, '协作与版本')
  await page.getByRole('button', { name: '获取线上更新' }).click()
  await expect(page.locator('p.ok')).toContainText('已获取线上更新，保留当前未发布的编辑内容。', {
    timeout: 90_000,
  })
}

export async function addSiteOwnerOnWorkspace(
  page: Page,
  siteName: string,
  ownerAccount: string,
): Promise<void> {
  await clickAdminNav(page, '设置')
  await openDetailSection(page, '网站成员')
  const owners = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: '网站成员' }) })
  await owners.getByPlaceholder('已有用户账号').fill(ownerAccount)
  await owners.getByRole('button', { name: '添加所有者' }).click()
  await expect(owners.getByText('已添加所有者')).toBeVisible()
  await page.goto('/workspace')
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

import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import pg from 'pg'
import {
  clickAdminNav, createDraftOnWorkspace, createSitePageAndOpen, pagePublicUrl,
  registerAndEnterWorkspace, requireApiReady, runPushExpectPublished, savePageDetail,
  openDetailSection, setPageBodyHtml,
} from './helpers'
import {
  adminAuthedJson, expectInquiryVisibleInAdmin, fetchDraftLinkedSiteId,
  patchDraftPage, siteInquiryFormMarkup, submitPublicInquiryForm,
} from './inquiry-helpers'

async function createWorkspace(page: Page, prefix: string) {
  await requireApiReady()
  const suffix = randomUUID().slice(0, 8)
  await registerAndEnterWorkspace(page, {
    account: `${prefix}-${suffix}`, password: 'E2ePass1!', name: '功能验收',
  })
  const { draftId } = await createDraftOnWorkspace(page, `功能验收 ${suffix}`)
  return { draftId, suffix }
}

async function addKnowledge(page: Page, suffix: string) {
  await page.getByPlaceholder('新建知识库名称').fill(`产品资料 ${suffix}`)
  await page.getByRole('button', { name: '新建知识库', exact: true }).click()
  await expect(page.getByRole('heading', { name: '知识库文档（0）' })).toBeVisible()
  await page.getByLabel('文档标题', { exact: true }).fill('产品说明')
  await page.getByLabel('文档内容', { exact: true }).fill('提供工业钢材产品与材料咨询服务。')
  await page.getByRole('button', { name: '添加文档', exact: true }).click()
  await expect(page.getByRole('heading', { name: '知识库文档（1）' })).toBeVisible()
}

async function submitExpectMissingModel(page: Page) {
  const submitted = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/jobs/generate_page' && response.request().method() === 'POST')
  await page.getByRole('button', { name: '提交生成任务', exact: true }).click()
  const response = await submitted
  expect(response.status()).toBe(202)
  const body = await response.json()
  expect(body.job.status).toBe('pending')
  await expect(page.locator('.badge')).toHaveText('failed', { timeout: 60_000 })
  await expect(page.locator('p.error').first()).toContainText('MINIMAX_API_KEY')
  const saved = await adminAuthedJson<{ job: { status: string; error: string; request: Record<string, unknown> } }>(
    page, 'GET', `/api/jobs/${body.job.jobId}`,
  )
  expect(saved.job.status).toBe('failed')
  expect(saved.job.error).toContain('MINIMAX_API_KEY')
  return saved.job
}

test('模型凭据未配置：生成任务保存 pending 并执行至 failed，页面列表保持为空', async ({ page }) => {
  const { draftId, suffix } = await createWorkspace(page, 'model')
  await clickAdminNav(page, '生成')
  await addKnowledge(page, suffix)
  await page.getByLabel('标题', { exact: true }).fill(`钢材产品 ${suffix}`)
  await page.getByLabel('页面地址', { exact: true }).fill(`products-${suffix}`)
  const job = await submitExpectMissingModel(page)
  expect(job.request.operation).toBe('generate')
  expect(job.request.draftId).toBe(draftId)
  expect(await adminAuthedJson(page, 'GET', `/api/drafts/${draftId}/pages`)).toMatchObject({ pages: [] })
  await page.reload()
  await expect(page.locator('.badge')).toHaveText('failed')
})

test('SEO 与语言关联通过界面保存，改写任务引用源页面且失败后保持页面内容', async ({ page }) => {
  const { draftId, suffix } = await createWorkspace(page, 'rewrite')
  const groupId = randomUUID()
  const { pageId } = await createSitePageAndOpen(page, { title: `产品 ${suffix}`, slug: `source-${suffix}` })
  await openDetailSection(page, '页面信息与 SEO')
  await page.getByLabel('语言', { exact: true }).fill('en')
  await page.getByLabel('翻译组', { exact: true }).fill(groupId)
  await page.getByLabel('SEO title', { exact: true }).fill(`Product SEO ${suffix}`)
  await page.getByLabel('SEO description', { exact: true }).fill('Industrial steel product information')
  await page.getByLabel('Canonical URL', { exact: true }).fill(`https://example.com/source-${suffix}/`)
  await page.getByLabel('分享图片 URL', { exact: true }).fill('https://example.com/product.jpg')
  await page.getByRole('combobox', { name: '搜索收录', exact: true }).selectOption('noindex,nofollow')
  await setPageBodyHtml(page, '<main><h1>Steel products</h1><p>Industrial materials.</p></main>')
  await savePageDetail(page)
  await page.reload()
  await openDetailSection(page, '页面信息与 SEO')
  await expect(page.getByLabel('翻译组', { exact: true })).toHaveValue(groupId)
  await expect(page.getByLabel('Canonical URL', { exact: true })).toHaveValue(`https://example.com/source-${suffix}/`)
  await expect(page.getByLabel('分享图片 URL', { exact: true })).toHaveValue('https://example.com/product.jpg')
  await expect(page.getByRole('combobox', { name: '搜索收录', exact: true })).toHaveValue('noindex,nofollow')
  const source = await adminAuthedJson<{ page: Record<string, unknown> }>(page, 'GET', `/api/drafts/${draftId}/pages/${pageId}`)
  expect(source.page).toMatchObject({ locale: 'en', translationGroupId: groupId, seo: {
    title: `Product SEO ${suffix}`, description: 'Industrial steel product information', robots: 'noindex,nofollow',
  } })
  await page.getByRole('link', { name: '改写页面', exact: true }).click()
  await expect(page.getByRole('heading', { name: '改写页面' })).toBeVisible()
  await expect(page.getByText(`来源页面：产品 ${suffix} · en`)).toBeVisible()
  await expect(page.getByRole('combobox', { name: '目标语言', exact: true })).toBeDisabled()
  await addKnowledge(page, suffix)
  await page.getByLabel('内容要求', { exact: true }).fill('补充钢材用途介绍')
  const job = await submitExpectMissingModel(page)
  expect(job.request).toMatchObject({ operation: 'rewrite', pageId, expectedUpdatedAt: source.page.updatedAt })
  const after = await adminAuthedJson(page, 'GET', `/api/drafts/${draftId}/pages/${pageId}`)
  expect(after).toEqual(source)
  const pages = await adminAuthedJson<{ pages: unknown[] }>(page, 'GET', `/api/drafts/${draftId}/pages`)
  expect(pages.pages).toHaveLength(1)
})

test('访客浏览及点击事件保存，询盘邮件显示等待配置并保持单个发送任务', async ({ page, browser }) => {
  const { draftId, suffix } = await createWorkspace(page, 'visitor')
  const title = `访客页面 ${suffix}`
  const slug = `visitor-${suffix}`
  const { pageId } = await createSitePageAndOpen(page, { title, slug })
  await patchDraftPage(page, draftId, pageId, {
    title, body: { html: `${siteInquiryFormMarkup()}<button type="button" data-olps-event="product_interest">Product details</button>` },
  })
  const { publicSiteUrl } = await runPushExpectPublished(page)
  const siteId = await fetchDraftLinkedSiteId(page, draftId)
  const databaseUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || 'postgres://olps:olps@127.0.0.1:5434/olps'
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const context = await browser.newContext()
  try {
    const visitor = await context.newPage()
    const viewed = visitor.waitForResponse(response => response.url().endsWith(`/api/public/${siteId}/events`) && response.request().postDataJSON()?.name === 'page_view')
    await visitor.goto(pagePublicUrl(publicSiteUrl, slug))
    expect((await viewed).status()).toBe(201)
    const clicked = visitor.waitForResponse(response => response.url().endsWith(`/api/public/${siteId}/events`) && response.request().postDataJSON()?.name === 'product_interest')
    await visitor.getByRole('button', { name: 'Product details' }).click()
    expect((await clicked).status()).toBe(201)
    const payload = { name: `Visitor ${suffix}`, email: `visitor-${suffix}@example.com`, message: `Inquiry ${suffix}` }
    const submitted = visitor.waitForResponse(response => response.url().endsWith(`/api/public/${siteId}/events`) && response.request().postDataJSON()?.name === 'inquiry_submit')
    await submitPublicInquiryForm(visitor, siteId, pageId, payload, 'Send inquiry')
    expect((await submitted).status()).toBe(201)
    await expect.poll(async () => {
      const saved = await pool.query('SELECT name FROM analytics_events WHERE site_id=$1 AND page_id=$2', [siteId, pageId])
      return saved.rows.map(row => row.name).sort()
    }).toEqual(['click', 'inquiry_submit', 'page_view', 'product_interest'])
    const rows = (await pool.query('SELECT name,payload FROM analytics_events WHERE site_id=$1 AND page_id=$2 ORDER BY event_id', [siteId, pageId])).rows
    expect(rows.find(row => row.name === 'product_interest')?.payload).toMatchObject({ label: 'Product details', path: new URL(pagePublicUrl(publicSiteUrl, slug)).pathname })
    const inquiryId = await expectInquiryVisibleInAdmin(page, siteId, pageId, payload)
    await expect(page.getByText('邮件服务尚未配置，发送任务等待配置完成。')).toBeVisible()
    await expect(page.getByText(/通知 #.*等待发送；发送次数：0；发送时间：尚未发送/)).toBeVisible()
    const mail = await adminAuthedJson<{ emails: Array<{ status: string; attempts: number; sentAt: string | null }>; configured: boolean }>(page, 'GET', `/api/inquiries/${inquiryId}/emails`)
    expect(mail.configured).toBe(false)
    expect(mail.emails).toHaveLength(1)
    expect(mail.emails[0]).toMatchObject({ status: 'pending', attempts: 0, sentAt: null })
    await page.getByRole('button', { name: '重发通知', exact: true }).click()
    await expect(page.getByText('邮件任务已经建立', { exact: true })).toBeVisible()
    const retried = await adminAuthedJson<{ emails: unknown[] }>(page, 'GET', `/api/inquiries/${inquiryId}/emails`)
    expect(retried.emails).toHaveLength(1)
  } finally {
    await context.close()
    await pool.end()
  }
})

test('同一翻译组的语言页面发布后具有 hreflang 和可访问的语言入口', async ({ page, browser }) => {
  const { draftId, suffix } = await createWorkspace(page, 'locales')
  const current = await adminAuthedJson<{ draft: { settings: Record<string, unknown> } }>(page, 'GET', `/api/drafts/${draftId}`)
  await adminAuthedJson(page, 'PATCH', `/api/drafts/${draftId}/settings`, {
    ...current.draft.settings, locales: ['en', 'fr'],
  })
  const groupId = randomUUID()
  await createSitePageAndOpen(page, { title: 'Steel products', slug: `steel-${suffix}` })
  await openDetailSection(page, '页面信息与 SEO')
  await page.getByLabel('翻译组', { exact: true }).fill(groupId)
  await savePageDetail(page)
  await createSitePageAndOpen(page, { title: 'Produits en acier', slug: `acier-${suffix}` })
  await openDetailSection(page, '页面信息与 SEO')
  await page.getByLabel('语言', { exact: true }).fill('fr')
  await page.getByLabel('翻译组', { exact: true }).fill(groupId)
  await page.getByLabel('SEO title', { exact: true }).fill('Produits en acier')
  await savePageDetail(page)
  const { publicSiteUrl } = await runPushExpectPublished(page)
  const context = await browser.newContext()
  try {
    const visitor = await context.newPage()
    const englishUrl = pagePublicUrl(publicSiteUrl, `steel-${suffix}`)
    const frenchUrl = pagePublicUrl(publicSiteUrl, `acier-${suffix}`)
    await visitor.goto(englishUrl)
    await expect(visitor.locator('link[rel="alternate"][hreflang="fr"]')).toHaveAttribute('href', frenchUrl)
    await expect(visitor.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute('href', englishUrl)
    await visitor.locator('[data-olps-languages] a').filter({ hasText: 'fr' }).click()
    await expect(visitor).toHaveURL(frenchUrl)
    await expect(visitor.locator('html')).toHaveAttribute('lang', 'fr')
    await expect(visitor).toHaveTitle('Produits en acier')
    await expect(visitor.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', englishUrl)
  } finally {
    await context.close()
  }
})

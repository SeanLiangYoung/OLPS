import { expect, test } from '@playwright/test'
import {
  createDraftOnWorkspace,
  createSitePageAndOpen,
  pagePublicUrl,
  registerAndEnterWorkspace,
  requireApiReady,
  runPushExpectPublished,
  savePageDetail,
  setPageBodyHtml,
} from './helpers'
import {
  adsKeywordPublicUrl,
  buildSitePageHtmlWithInquiry,
  createAdsPageAndOpen,
  draftIdFromAdminDetailUrl,
  expectInquiryVisibleInAdmin,
  fetchDraftLinkedSiteId,
  fetchPrimaryTenantId,
  pageIdFromAdminDetailUrl,
  patchDraftPage,
  publicInquiryApiPath,
  adminAuthedJson,
  submitPublicInquiryForm,
  type InquirySubmitPayload,
} from './inquiry-helpers'

/**
 * 真实 public 询盘 E2E：Admin + 管理 API + 远端 HTTP + PostgreSQL。
 * 本轮仅编写用例；主控启动专用 e2e 库与全套服务后执行 RED/GREEN。
 * 禁止连接生产库 olps 或迁移快照库。
 */

async function pushPageWithInquiryHtml(
  adminPage: Parameters<typeof createSitePageAndOpen>[0],
  input: { title: string; slug: string; heading: string; suffix: string },
): Promise<{
  draftId: string
  pageId: string
  tenantId: string
  siteId: string
  publicSiteUrl: string
  publicPageUrl: string
}> {
  await createSitePageAndOpen(adminPage, { title: input.title, slug: input.slug })
  const draftId = draftIdFromAdminDetailUrl(adminPage.url())
  const pageId = pageIdFromAdminDetailUrl(adminPage.url())
  await setPageBodyHtml(adminPage, '<p>pending push</p>')
  await savePageDetail(adminPage)
  const { publicSiteUrl } = await runPushExpectPublished(adminPage)
  const tenantId = await fetchPrimaryTenantId(adminPage)
  const siteId = await fetchDraftLinkedSiteId(adminPage, draftId)
  const inquiryPath = publicInquiryApiPath(tenantId, siteId, pageId)
  const html = buildSitePageHtmlWithInquiry(inquiryPath, input.heading)
  await patchDraftPage(adminPage, draftId, pageId, {
    title: input.title,
    seo: { title: input.title, description: `E2E inquiry ${input.suffix}` },
    body: { html },
  })
  await adminPage.getByRole('link', { name: '发布与同步' }).click()
  await adminPage.getByRole('button', { name: 'Push 并发布' }).click()
  await expect(adminPage.locator('p.ok')).toContainText('Push 成功', { timeout: 90_000 })
  const publicPageUrl = pagePublicUrl(publicSiteUrl, input.slug)
  return { draftId, pageId, tenantId, siteId, publicSiteUrl, publicPageUrl }
}

test('通用站页：访客浏览器提交询盘，POST 含 pageId，Admin 与 API 可见', async ({
  browser,
  page: adminPage,
}) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const payload: InquirySubmitPayload = {
    name: `Site Guest ${suffix}`,
    email: `site-${suffix}@example.com`,
    message: `E2E site inquiry ${suffix}`,
  }

  await registerAndEnterWorkspace(adminPage, {
    account: `inq-site-${suffix}`,
    password: 'E2ePass1!',
    name: 'Inquiry Site',
  })
  await createDraftOnWorkspace(adminPage, `询盘站页 ${suffix}`)

  const ctx = await browser.newContext()
  const publicPage = await ctx.newPage()
  try {
    const { pageId, siteId, publicPageUrl, tenantId } = await pushPageWithInquiryHtml(
      adminPage,
      {
        title: `询盘页 ${suffix}`,
        slug: `inq-site-${suffix}`,
        heading: `Welcome ${suffix}`,
        suffix,
      },
    )

    await publicPage.goto(publicPageUrl)
    await expect(publicPage.locator('form[data-olps-inquiry]')).toBeVisible()

    const { postUrl, postBody, pageIdFromQuery } = await submitPublicInquiryForm(publicPage, payload)
    expect(pageIdFromQuery).toBe(pageId)
    expect(postBody).toEqual(payload)
    expect(postUrl).toContain(`/api/public/${tenantId}/${siteId}/inquiries`)
    expect(postUrl).toContain(`pageId=${encodeURIComponent(pageId)}`)
    await expect(publicPage.locator('[data-olps-inquiry-status]')).toHaveText('Submitted')

    await expectInquiryVisibleInAdmin(adminPage, siteId, pageId, payload)
  } finally {
    await ctx.close()
  }
})

test('广告承接页：Push 后 CTA 表单提交询盘并写入 Admin', async ({ browser, page: adminPage }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const keywordA = `buy-${suffix}`
  const keywordB = `rent-${suffix}`
  const payload: InquirySubmitPayload = {
    name: `Ads Guest ${suffix}`,
    email: `ads-${suffix}@example.com`,
    message: `E2E ads inquiry ${suffix}`,
  }

  await registerAndEnterWorkspace(adminPage, {
    account: `inq-ads-${suffix}`,
    password: 'E2ePass1!',
    name: 'Inquiry Ads',
  })
  await createDraftOnWorkspace(adminPage, `询盘广告 ${suffix}`)

  const { pageId, draftId } = await createAdsPageAndOpen(adminPage, {
    title: `Ads ${suffix}`,
    slug: `inq-ads-${suffix}`,
    keywordA,
    keywordB,
  })

  const { publicSiteUrl } = await runPushExpectPublished(adminPage)
  const tenantId = await fetchPrimaryTenantId(adminPage)
  const siteId = await fetchDraftLinkedSiteId(adminPage, draftId)
  const landingUrl = adsKeywordPublicUrl(publicSiteUrl, `inq-ads-${suffix}`, keywordA)

  const ctx = await browser.newContext()
  const publicPage = await ctx.newPage()
  try {
    await publicPage.goto(landingUrl)
    await publicPage.getByRole('button', { name: 'Inquire now' }).click()
    await expect(publicPage.locator('form[data-olps-inquiry]')).toBeVisible()

    const { postBody, pageIdFromQuery, postUrl } = await submitPublicInquiryForm(publicPage, payload)
    expect(pageIdFromQuery).toBe(pageId)
    expect(postBody).toEqual(payload)
    expect(postUrl).toContain(`/api/public/${tenantId}/${siteId}/inquiries`)
    await expect(publicPage.locator('[data-olps-inquiry-status]')).toHaveText('Submitted')

    await expectInquiryVisibleInAdmin(adminPage, siteId, pageId, payload)
  } finally {
    await ctx.close()
  }
})

test('通用站页：离线提交不触发文档导航，恢复在线后再次提交成功', async ({
  browser,
  page: adminPage,
}) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const offlinePayload: InquirySubmitPayload = {
    name: `Offline ${suffix}`,
    email: `off-${suffix}@example.com`,
    message: `Should not persist ${suffix}`,
  }
  const onlinePayload: InquirySubmitPayload = {
    name: `Online ${suffix}`,
    email: `on-${suffix}@example.com`,
    message: `E2E online after offline ${suffix}`,
  }

  await registerAndEnterWorkspace(adminPage, {
    account: `inq-off-${suffix}`,
    password: 'E2ePass1!',
    name: 'Inquiry Offline',
  })
  await createDraftOnWorkspace(adminPage, `离线询盘 ${suffix}`)

  const { pageId, siteId, publicPageUrl } = await pushPageWithInquiryHtml(adminPage, {
    title: `离线页 ${suffix}`,
    slug: `inq-off-${suffix}`,
    heading: `Offline test ${suffix}`,
    suffix,
  })

  const ctx = await browser.newContext()
  const publicPage = await ctx.newPage()
  try {
    await publicPage.goto(publicPageUrl)
    const urlAtStart = publicPage.url()

    await ctx.setOffline(true)
    await publicPage.locator('form[data-olps-inquiry] input[name="name"]').fill(offlinePayload.name)
    await publicPage.locator('form[data-olps-inquiry] input[name="email"]').fill(offlinePayload.email)
    await publicPage
      .locator('form[data-olps-inquiry] textarea[name="message"]')
      .fill(offlinePayload.message)
    await publicPage.locator('form[data-olps-inquiry] button[type="submit"]').click()
    await expect(publicPage.locator('[data-olps-inquiry-status]')).toHaveText('Submit failed', {
      timeout: 30_000,
    })
    expect(publicPage.url()).toBe(urlAtStart)

    await ctx.setOffline(false)
    const { postBody, pageIdFromQuery } = await submitPublicInquiryForm(publicPage, onlinePayload)
    expect(pageIdFromQuery).toBe(pageId)
    expect(postBody).toEqual(onlinePayload)
    await expect(publicPage.locator('[data-olps-inquiry-status]')).toHaveText('Submitted')

    await expectInquiryVisibleInAdmin(adminPage, siteId, pageId, onlinePayload)

    const list = await adminAuthedJson<{ inquiries: Array<{ payload: Record<string, unknown> }> }>(
      adminPage,
      'GET',
      `/api/sites/${siteId}/inquiries`,
    )
    const leaked = (list.inquiries ?? []).some(
      (row) => row.payload?.message === offlinePayload.message,
    )
    expect(leaked).toBe(false)
  } finally {
    await ctx.setOffline(false)
    await ctx.close()
  }
})

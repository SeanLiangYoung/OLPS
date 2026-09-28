import { expect, test } from '@playwright/test'
import {
  createDraftOnWorkspace,
  createSitePageAndOpen,
  registerAndEnterWorkspace,
  requireApiReady,
  runPushExpectPublished,
} from './helpers'
import {
  adminAuthedJson,
  createAdsPageAndOpen,
  draftIdFromAdminDetailUrl,
  expectInquiryVisibleInAdmin,
  fetchDraftLinkedSiteId,
  fetchDraftPagePublicUrls,
  INQUIRY_SUBMITTED_STATUS,
  pageIdFromAdminDetailUrl,
  patchDraftPage,
  pickFirstAdsKeywordPublicUrl,
  pickSitePagePublicUrl,
  siteInquiryFormMarkup,
  submitPublicInquiryForm,
  type InquirySubmitPayload,
} from './inquiry-helpers'

/**
 * 真实 public 询盘 E2E：Admin + 管理 API + 远端 HTTP + PostgreSQL。
 * 访客提交依赖 @olps/site-builder 注入的 inquiry-runtime / ads-runtime，测试 HTML 仅含 data-olps-inquiry 表单。
 * 主控启动专用 e2e 库与全套服务后执行；服务未就绪时不得当作业务 RED。
 */

async function publishSitePageWithInquiryForm(
  adminPage: Parameters<typeof createSitePageAndOpen>[0],
  input: { title: string; slug: string; suffix: string },
): Promise<{
  draftId: string
  pageId: string
  siteId: string
  publicPageUrl: string
}> {
  await createSitePageAndOpen(adminPage, { title: input.title, slug: input.slug })
  const draftId = draftIdFromAdminDetailUrl(adminPage.url())
  const pageId = pageIdFromAdminDetailUrl(adminPage.url())
  await patchDraftPage(adminPage, draftId, pageId, {
    title: input.title,
    seo: { title: input.title, description: `E2E inquiry ${input.suffix}` },
    body: { html: siteInquiryFormMarkup() },
  })
  await runPushExpectPublished(adminPage)
  const siteId = await fetchDraftLinkedSiteId(adminPage, draftId)
  const publicUrls = await fetchDraftPagePublicUrls(adminPage, draftId, pageId)
  const publicPageUrl = pickSitePagePublicUrl(publicUrls)
  return { draftId, pageId, siteId, publicPageUrl }
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
    const { pageId, siteId, publicPageUrl } = await publishSitePageWithInquiryForm(adminPage, {
      title: `询盘页 ${suffix}`,
      slug: `inq-site-${suffix}`,
      suffix,
    })

    await publicPage.goto(publicPageUrl)
    await expect(publicPage.locator('form[data-olps-inquiry]')).toBeVisible()

    const { postBody } = await submitPublicInquiryForm(
      publicPage,
      siteId,
      pageId,
      payload,
      'Send inquiry',
    )
    expect(postBody).toEqual(payload)
    await expect(publicPage.locator('[data-olps-inquiry-status]')).toHaveText(INQUIRY_SUBMITTED_STATUS)

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
  const pageSlug = `inq-ads-${suffix}`
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
    slug: pageSlug,
    keywordA,
    keywordB,
  })

  await runPushExpectPublished(adminPage)
  const siteId = await fetchDraftLinkedSiteId(adminPage, draftId)
  const publicUrls = await fetchDraftPagePublicUrls(adminPage, draftId, pageId)
  const landingUrl = pickFirstAdsKeywordPublicUrl(publicUrls, pageSlug)

  const ctx = await browser.newContext()
  const publicPage = await ctx.newPage()
  try {
    await publicPage.goto(landingUrl)
    await publicPage.getByRole('button', { name: 'Go' }).click()
    await expect(publicPage.locator('form[data-olps-inquiry]')).toBeVisible()

    const { postBody } = await submitPublicInquiryForm(
      publicPage,
      siteId,
      pageId,
      payload,
      'Send ads',
    )
    expect(postBody).toEqual(payload)
    await expect(publicPage.locator('[data-olps-inquiry-status]')).toHaveText(INQUIRY_SUBMITTED_STATUS)

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

  const { pageId, siteId, publicPageUrl } = await publishSitePageWithInquiryForm(adminPage, {
    title: `离线页 ${suffix}`,
    slug: `inq-off-${suffix}`,
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
    await publicPage.getByRole('button', { name: 'Send inquiry' }).click()
    await expect(publicPage.locator('[data-olps-inquiry-status]')).not.toHaveText(
      INQUIRY_SUBMITTED_STATUS,
      { timeout: 15_000 },
    )
    expect(publicPage.url()).toBe(urlAtStart)

    await ctx.setOffline(false)
    const { postBody } = await submitPublicInquiryForm(
      publicPage,
      siteId,
      pageId,
      onlinePayload,
      'Send inquiry',
    )
    expect(postBody).toEqual(onlinePayload)
    await expect(publicPage.locator('[data-olps-inquiry-status]')).toHaveText(INQUIRY_SUBMITTED_STATUS)

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

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
  adsIndexLinkTitle,
  createAdsPageAndOpen,
  draftIdFromAdminDetailUrl,
  expectInquiryVisibleInAdmin,
  fetchDraftLinkedSiteId,
  INQUIRY_SUBMITTED_STATUS,
  openPageFromPublishedSiteIndex,
  pageIdFromAdminDetailUrl,
  patchDraftPage,
  siteInquiryFormMarkup,
  submitPublicInquiryForm,
  submitPublicInquiryOfflineExpectRequestFailed,
  type InquirySubmitPayload,
} from './inquiry-helpers'

/**
 * 真实 public 询盘 E2E：Admin + 管理 API + 远端 HTTP + PostgreSQL。
 * 访客从 Push 后的 publicSiteUrl 首页链进入页面（site-builder index 链接文案）。
 * 主控启动专用 e2e 库与全套服务后执行；服务未就绪时不得当作业务 RED。
 */

async function publishSitePageWithInquiryForm(
  adminPage: Parameters<typeof createSitePageAndOpen>[0],
  input: { title: string; slug: string; suffix: string },
): Promise<{
  draftId: string
  pageId: string
  siteId: string
  publicSiteUrl: string
  pageTitle: string
}> {
  await createSitePageAndOpen(adminPage, { title: input.title, slug: input.slug })
  const draftId = draftIdFromAdminDetailUrl(adminPage.url())
  const pageId = pageIdFromAdminDetailUrl(adminPage.url())
  await patchDraftPage(adminPage, draftId, pageId, {
    title: input.title,
    seo: { title: input.title, description: `E2E inquiry ${input.suffix}` },
    body: { html: siteInquiryFormMarkup() },
  })
  const { publicSiteUrl } = await runPushExpectPublished(adminPage)
  const siteId = await fetchDraftLinkedSiteId(adminPage, draftId)
  return { draftId, pageId, siteId, publicSiteUrl, pageTitle: input.title }
}

async function publishAdsPageWithInquiryCta(
  adminPage: Parameters<typeof createSitePageAndOpen>[0],
  input: { title: string; slug: string; keywordA: string; keywordB: string },
): Promise<{
  draftId: string
  pageId: string
  siteId: string
  publicSiteUrl: string
  pageTitle: string
  keywordA: string
}> {
  const { draftId, pageId } = await createAdsPageAndOpen(adminPage, input)
  const { publicSiteUrl } = await runPushExpectPublished(adminPage)
  const siteId = await fetchDraftLinkedSiteId(adminPage, draftId)
  return {
    draftId,
    pageId,
    siteId,
    publicSiteUrl,
    pageTitle: input.title,
    keywordA: input.keywordA,
  }
}

async function openAdsCtaFromPublishedIndex(
  publicPage: Parameters<typeof openPageFromPublishedSiteIndex>[0],
  publicSiteUrl: string,
  pageTitle: string,
  keyword: string,
): Promise<string> {
  const pageUrl = await openPageFromPublishedSiteIndex(
    publicPage,
    publicSiteUrl,
    adsIndexLinkTitle(pageTitle, keyword),
  )
  await publicPage.getByRole('button', { name: 'Go' }).click()
  await expect(publicPage.locator('form[data-olps-inquiry]')).toBeVisible()
  return pageUrl
}

test('通用站页：访客浏览器提交询盘，POST 含 pageId，Admin 与 API 可见', async ({
  browser,
  page: adminPage,
}) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const pageTitle = `询盘页 ${suffix}`
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
    const { pageId, siteId, publicSiteUrl } = await publishSitePageWithInquiryForm(adminPage, {
      title: pageTitle,
      slug: `inq-site-${suffix}`,
      suffix,
    })

    await openPageFromPublishedSiteIndex(publicPage, publicSiteUrl, pageTitle)
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
  const pageTitle = `Ads ${suffix}`
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

  const ctx = await browser.newContext()
  const publicPage = await ctx.newPage()
  try {
    const { pageId, siteId, publicSiteUrl } = await publishAdsPageWithInquiryCta(adminPage, {
      title: pageTitle,
      slug: `inq-ads-${suffix}`,
      keywordA,
      keywordB,
    })

    await openAdsCtaFromPublishedIndex(publicPage, publicSiteUrl, pageTitle, keywordA)

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

test('通用站页：离线 POST 失败后无导航，恢复在线 POST 201 并入库', async ({
  browser,
  page: adminPage,
}) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const pageTitle = `离线页 ${suffix}`
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
    account: `inq-off-site-${suffix}`,
    password: 'E2ePass1!',
    name: 'Inquiry Offline Site',
  })
  await createDraftOnWorkspace(adminPage, `离线询盘站 ${suffix}`)

  const { pageId, siteId, publicSiteUrl } = await publishSitePageWithInquiryForm(adminPage, {
    title: pageTitle,
    slug: `inq-off-site-${suffix}`,
    suffix,
  })

  const ctx = await browser.newContext()
  const publicPage = await ctx.newPage()
  try {
    await openPageFromPublishedSiteIndex(publicPage, publicSiteUrl, pageTitle)
    await expect(publicPage.locator('form[data-olps-inquiry]')).toBeVisible()

    await ctx.setOffline(true)
    await submitPublicInquiryOfflineExpectRequestFailed(
      publicPage,
      siteId,
      pageId,
      offlinePayload,
      'Send inquiry',
    )

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

test('广告 CTA：离线 POST 失败后无导航，恢复在线 POST 201 并入库', async ({
  browser,
  page: adminPage,
}) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const keywordA = `buy-${suffix}`
  const keywordB = `rent-${suffix}`
  const pageTitle = `Ads Off ${suffix}`
  const offlinePayload: InquirySubmitPayload = {
    name: `Ads Off ${suffix}`,
    email: `ads-off-${suffix}@example.com`,
    message: `Ads should not persist ${suffix}`,
  }
  const onlinePayload: InquirySubmitPayload = {
    name: `Ads On ${suffix}`,
    email: `ads-on-${suffix}@example.com`,
    message: `E2E ads online after offline ${suffix}`,
  }

  await registerAndEnterWorkspace(adminPage, {
    account: `inq-off-ads-${suffix}`,
    password: 'E2ePass1!',
    name: 'Inquiry Offline Ads',
  })
  await createDraftOnWorkspace(adminPage, `离线询盘广告 ${suffix}`)

  const { pageId, siteId, publicSiteUrl } = await publishAdsPageWithInquiryCta(adminPage, {
    title: pageTitle,
    slug: `inq-off-ads-${suffix}`,
    keywordA,
    keywordB,
  })

  const ctx = await browser.newContext()
  const publicPage = await ctx.newPage()
  try {
    await openAdsCtaFromPublishedIndex(publicPage, publicSiteUrl, pageTitle, keywordA)

    await ctx.setOffline(true)
    await submitPublicInquiryOfflineExpectRequestFailed(
      publicPage,
      siteId,
      pageId,
      offlinePayload,
      'Send ads',
    )

    await ctx.setOffline(false)
    const { postBody } = await submitPublicInquiryForm(
      publicPage,
      siteId,
      pageId,
      onlinePayload,
      'Send ads',
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

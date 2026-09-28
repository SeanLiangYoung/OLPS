import { expect, test } from '@playwright/test'
import {
  addSiteOwnerOnWorkspace,
  clickAdminNav,
  createDraftOnWorkspace,
  createSitePageAndOpen,
  fetchPublicDocument,
  pagePublicUrl,
  registerAndEnterWorkspace,
  requireApiReady,
  runPullExpectComplete,
  runPushExpectPublished,
  savePageDetail,
  setPageBodyHtml,
  setPageSeoDescription,
} from './helpers'

function openFirstPageDetailFromList(page: import('@playwright/test').Page): Promise<void> {
  return page.locator('table.table').getByRole('link', { name: '详情' }).first().click()
}

test('两用户协作：注册、草稿、编辑、Push、公开 URL、Pull 后编辑', async ({ browser }) => {
  await requireApiReady()

  const suffix = Date.now().toString(36)
  const userA = { account: `e2e-a-${suffix}`, password: 'E2ePass1!', name: 'E2E A' }
  const userB = { account: `e2e-b-${suffix}`, password: 'E2ePass1!', name: 'E2E B' }
  const draftNameA = `协作站 ${suffix}`
  const draftNameB = `B 草稿 ${suffix}`
  const pageTitle = `协作页 ${suffix}`
  const pageSlug = `e2e-collab-${suffix}`
  const markerA1 = `E2E_COLLAB_A1_${suffix}`
  const markerB = `E2E_COLLAB_B_${suffix}`
  const markerA2 = `E2E_COLLAB_A2_${suffix}`

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    await registerAndEnterWorkspace(pageA, userA)
    await createDraftOnWorkspace(pageA, draftNameA)
    await createSitePageAndOpen(pageA, { title: pageTitle, slug: pageSlug })
    await setPageBodyHtml(pageA, `<p>${markerA1}</p>`)
    await savePageDetail(pageA)

    const { publicSiteUrl, siteName } = await runPushExpectPublished(pageA)
    const publicPageUrl = pagePublicUrl(publicSiteUrl, pageSlug)
    const firstPublished = await fetchPublicDocument(publicPageUrl)
    expect(firstPublished).toContain(markerA1)

    await registerAndEnterWorkspace(pageB, userB)
    await expect(pageB.locator('.workspace-page')).not.toContainText(draftNameA)
    await expect(pageB.getByRole('link', { name: publicSiteUrl })).toHaveCount(0)

    await addSiteOwnerOnWorkspace(pageA, siteName, userB.account)

    await pageB.goto('/workspace')
    await expect(pageB.getByRole('link', { name: publicSiteUrl })).toBeVisible()

    await createDraftOnWorkspace(pageB, draftNameB, { basedOnSiteName: siteName })
    await clickAdminNav(pageB, '页面')
    await openFirstPageDetailFromList(pageB)
    await setPageBodyHtml(pageB, `<p>${markerA1}</p><p>${markerB}</p>`)
    await savePageDetail(pageB)

    await pageA.getByRole('button', { name: '切换工作区' }).click()
    await pageA.locator('button.workspace-item').filter({ hasText: draftNameA }).click()
    await clickAdminNav(pageA, '页面')
    await openFirstPageDetailFromList(pageA)
    await setPageSeoDescription(pageA, markerA2)
    await savePageDetail(pageA)
    await runPushExpectPublished(pageA)

    await runPullExpectComplete(pageB)
    await clickAdminNav(pageB, '页面')
    await openFirstPageDetailFromList(pageB)
    await expect(pageB.locator('label:has-text("body.html") textarea')).toContainText(markerB)
    await expect(pageB.locator('label:has-text("SEO description") textarea')).toHaveValue(markerA2)

    await runPushExpectPublished(pageB)
    const finalHtml = await fetchPublicDocument(publicPageUrl)
    expect(finalHtml).toContain(markerA1)
    expect(finalHtml).toContain(markerB)
    expect(finalHtml).toContain(markerA2)
  } finally {
    await contextB.close()
    await contextA.close()
  }
})

import { expect, test } from '@playwright/test'
import {
  clickAdminNav,
  createDraftOnWorkspace,
  createSitePageAndOpen,
  fetchPublicDocument,
  pagePublicUrl,
  runPushExpectPublished,
  savePageDetail,
  setPageBodyHtml,
  openDetailSection,
} from './helpers'
import {
  assertPageOnDedicatedAdmin,
  fetchDraftPageHtml,
  fetchDraftPageIdBySlug,
  pushPublishedV2OnDraftA,
  readOlpsAccessToken,
  registerOnDedicatedAdminLogin,
} from './e2e-dedicated-api-helpers'
import { startDedicatedE2eStack } from './dedicated-e2e-stack'

test.describe.configure({ mode: 'serial' })

test('Pull 远端中断后页面展示 lastError 且恢复远端后可再次 Pull 并写入 sandbox', async ({
  page,
}) => {
  const stack = await startDedicatedE2eStack('pull-retry')
  const originalApiUrl = process.env.OLPS_API_URL
  process.env.OLPS_API_URL = stack.apiBaseUrl
  try {
    const suffix = Date.now().toString(36)
    const v1Marker = `E2E_PULL_V1_${suffix}`
    const v2Marker = `E2E_PULL_V2_${suffix}`
    const v1Html = `<p>${v1Marker}</p>`
    const v2Html = `<h1>${v2Marker}</h1>`
    const slug = `pull-retry-${suffix}`

    await registerOnDedicatedAdminLogin(page, stack.adminBaseUrl, {
      account: `pull-retry-${suffix}`,
      password: 'E2ePass1!',
      name: 'Pull Retry',
    })

    await createDraftOnWorkspace(page, `Pull A ${suffix}`)
    const { pageId, draftId: draftAId } = await createSitePageAndOpen(page, {
      title: `页 ${suffix}`,
      slug,
    })
    await setPageBodyHtml(page, v1Html)
    await savePageDetail(page)

    const { siteName, publicSiteUrl } = await runPushExpectPublished(page)

    const accessToken = await readOlpsAccessToken(page)

    await page.goto(`${stack.adminBaseUrl}/workspace`)
    await assertPageOnDedicatedAdmin(page, stack.adminBaseUrl)
    const { draftId: draftBId } = await createDraftOnWorkspace(page, `Pull B ${suffix}`, {
      basedOnSiteName: siteName,
    })

    await pushPublishedV2OnDraftA({
      apiBaseUrl: stack.apiBaseUrl,
      accessToken,
      draftAId,
      pageId,
      v2Html,
    })
    const liveAfterV2 = await fetchPublicDocument(pagePublicUrl(publicSiteUrl, slug))
    expect(liveAfterV2).toContain(v2Marker)

    await clickAdminNav(page, '发布与同步')
    await openDetailSection(page, '协作与版本')
    await assertPageOnDedicatedAdmin(page, stack.adminBaseUrl)
    await stack.stopRemoteOnly()

    const pullFailWait = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/drafts\/[^/]+\/pull$/.test(new URL(r.url()).pathname.replace(/\/$/, '')),
      { timeout: 180_000 },
    )
    await page.getByRole('button', { name: '获取线上更新' }).click()
    const pullFailRes = await pullFailWait
    expect(pullFailRes.ok()).toBe(false)

    await expect(page.getByRole('alert').filter({ hasText: /.+/ }).first()).toBeVisible({
      timeout: 60_000,
    })
    await page.getByRole('button', { name: '刷新状态', exact: true }).click()
    await expect(page.locator('.panel p.error').filter({ hasText: /.+/ }).last()).not.toHaveText('')
    await expect(page.getByRole('button', { name: '获取线上更新' })).toBeEnabled()

    await stack.restartRemote()

    const pullOkWait = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/drafts\/[^/]+\/pull$/.test(new URL(r.url()).pathname.replace(/\/$/, '')),
      { timeout: 180_000 },
    )
    await page.getByRole('button', { name: '获取线上更新' }).click()
    const pullOkRes = await pullOkWait
    expect(pullOkRes.ok()).toBe(true)
    await expect(page.locator('p.ok')).toContainText('已获取线上更新，保留当前未发布的编辑内容。', {
      timeout: 60_000,
    })

    const pageIdOnB = await fetchDraftPageIdBySlug({
      apiBaseUrl: stack.apiBaseUrl,
      accessToken,
      draftId: draftBId,
      slug,
    })
    const bodyTextarea = page.locator('label:has-text("body.html") textarea')
    const pageDetailWait = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        new URL(r.url()).pathname.replace(/\/$/, '') ===
          `/api/drafts/${draftBId}/pages/${pageIdOnB}`,
      { timeout: 180_000 },
    )
    await page.goto(`${stack.adminBaseUrl}/drafts/${draftBId}/pages/${pageIdOnB}`)
    await pageDetailWait
    await assertPageOnDedicatedAdmin(page, stack.adminBaseUrl)
    await openDetailSection(page, '高级 HTML 正文')
    const htmlOnB = await fetchDraftPageHtml({
      apiBaseUrl: stack.apiBaseUrl,
      accessToken,
      draftId: draftBId,
      pageId: pageIdOnB,
    })
    expect(htmlOnB).toBe(v2Html)
    await expect(bodyTextarea).toHaveValue(v2Html, { timeout: 60_000 })
    await expect(bodyTextarea).not.toHaveValue(v1Html)
    expect(await bodyTextarea.inputValue()).not.toContain(v1Marker)
  } finally {
    if (originalApiUrl === undefined) delete process.env.OLPS_API_URL
    else process.env.OLPS_API_URL = originalApiUrl
    await stack.stop()
  }
})

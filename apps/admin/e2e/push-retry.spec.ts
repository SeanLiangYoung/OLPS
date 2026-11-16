import { expect, test } from '@playwright/test'
import {
  clickAdminNav,
  createDraftOnWorkspace,
  createSitePageAndOpen,
  fetchPublicDocument,
  pagePublicUrl,
  registerAndEnterWorkspace,
  runPushExpectPublished,
  savePageDetail,
  setPageBodyHtml,
  preparePublication,
} from './helpers'
import { assertPageOnDedicatedAdmin } from './e2e-dedicated-api-helpers'
import { startDedicatedE2eStack } from './dedicated-e2e-stack'

test.describe.configure({ mode: 'serial' })

test('Push 远端中断后页面展示 lastError 且恢复远端后可再次 Push', async ({ page }) => {
  const stack = await startDedicatedE2eStack('push-retry')
  const originalApiUrl = process.env.OLPS_API_URL
  process.env.OLPS_API_URL = stack.apiBaseUrl
  try {
    const suffix = Date.now().toString(36)
    const markerAfterRetry = `E2E_PUSH_RETRY_${suffix}`

    await page.goto(`${stack.adminBaseUrl}/login`)
    await assertPageOnDedicatedAdmin(page, stack.adminBaseUrl)
    await page.getByRole('tab', { name: '注册' }).click()
    await page.locator('#reg-name').fill('Push Retry')
    await page.locator('#reg-account').fill(`push-retry-${suffix}`)
    await page.locator('#reg-password').fill('E2ePass1!')
    await page.getByRole('button', { name: '注册并进入' }).click()
    await expect(page).toHaveURL(/\/workspace/)
    await assertPageOnDedicatedAdmin(page, stack.adminBaseUrl)
    await createDraftOnWorkspace(page, `Push 重试 ${suffix}`)
    await createSitePageAndOpen(page, {
      title: `页 ${suffix}`,
      slug: `push-retry-${suffix}`,
    })
    await setPageBodyHtml(page, `<p>initial-${suffix}</p>`)
    await savePageDetail(page)

    const { publicSiteUrl } = await runPushExpectPublished(page)

    await clickAdminNav(page, '页面')
    await page.locator('table.table').getByRole('link', { name: '编辑页面' }).first().click()
    await setPageBodyHtml(page, `<h1>${markerAfterRetry}</h1>`)
    await savePageDetail(page)

    await preparePublication(page)
    await stack.stopRemoteOnly()

    const pushFailWait = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/drafts\/[^/]+\/publication\/confirm$/.test(new URL(r.url()).pathname.replace(/\/$/, '')),
      { timeout: 180_000 },
    )
    await page.getByRole('button', { name: '确认发布', exact: true }).click()
    const pushFailRes = await pushFailWait
    expect(pushFailRes.ok()).toBe(false)

    await expect(page.getByRole('alert').filter({ hasText: /.+/ }).first()).toBeVisible({
      timeout: 60_000,
    })
    const lastErrorLine = page.getByRole('alert').last()
    await expect(lastErrorLine).not.toHaveText('')
    await expect(page.getByRole('button', { name: '发布所选页面', exact: true })).toBeEnabled()

    await stack.restartRemote()

    await runPushExpectPublished(page)

    const publicPageUrl = pagePublicUrl(publicSiteUrl, `push-retry-${suffix}`)
    const html = await fetchPublicDocument(publicPageUrl)
    expect(html).toContain(markerAfterRetry)
  } finally {
    if (originalApiUrl === undefined) delete process.env.OLPS_API_URL
    else process.env.OLPS_API_URL = originalApiUrl
    await stack.stop()
  }
})

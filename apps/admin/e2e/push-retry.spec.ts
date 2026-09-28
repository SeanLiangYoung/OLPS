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
} from './helpers'
import { startDedicatedE2eStack } from './dedicated-e2e-stack'

test.describe.configure({ mode: 'serial' })

test('Push 远端中断后页面展示 lastError 且恢复远端后可再次 Push', async ({ page }) => {
  const stack = await startDedicatedE2eStack('push-retry')
  process.env.OLPS_API_URL = stack.apiBaseUrl
  try {
    const suffix = Date.now().toString(36)
    const markerAfterRetry = `E2E_PUSH_RETRY_${suffix}`

    await page.goto(`${stack.adminBaseUrl}/login`)
    await page.getByRole('tab', { name: '注册' }).click()
    await page.locator('#reg-name').fill('Push Retry')
    await page.locator('#reg-account').fill(`push-retry-${suffix}`)
    await page.locator('#reg-password').fill('E2ePass1!')
    await page.getByRole('button', { name: '注册并进入' }).click()
    await expect(page).toHaveURL(/\/workspace/)
    await createDraftOnWorkspace(page, `Push 重试 ${suffix}`)
    await createSitePageAndOpen(page, {
      title: `页 ${suffix}`,
      slug: `push-retry-${suffix}`,
    })
    await setPageBodyHtml(page, `<p>initial-${suffix}</p>`)
    await savePageDetail(page)

    const { publicSiteUrl } = await runPushExpectPublished(page)

    await clickAdminNav(page, '页面')
    await page.locator('table.table').getByRole('link', { name: '详情' }).first().click()
    await setPageBodyHtml(page, `<h1>${markerAfterRetry}</h1>`)
    await savePageDetail(page)

    await clickAdminNav(page, '发布与同步')
    await stack.stopRemoteOnly()

    const pushFailWait = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/drafts\/[^/]+\/push$/.test(new URL(r.url()).pathname.replace(/\/$/, '')),
      { timeout: 180_000 },
    )
    await page.getByRole('button', { name: 'Push 并发布' }).click()
    const pushFailRes = await pushFailWait
    expect(pushFailRes.ok()).toBe(false)

    await expect(page.locator('section.panel p.error').filter({ hasText: /.+/ }).first()).toBeVisible({
      timeout: 60_000,
    })
    const lastErrorLine = page.locator('.panel p.error').last()
    await expect(lastErrorLine).not.toHaveText('')
    await expect(page.getByRole('button', { name: 'Push 并发布' })).toBeEnabled()

    await stack.restartRemote()

    const pushOkWait = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/drafts\/[^/]+\/push$/.test(new URL(r.url()).pathname.replace(/\/$/, '')),
      { timeout: 180_000 },
    )
    await page.getByRole('button', { name: 'Push 并发布' }).click()
    const pushOkRes = await pushOkWait
    expect(pushOkRes.ok()).toBe(true)
    await expect(page.locator('p.ok')).toContainText('Push 成功', { timeout: 60_000 })

    const publicPageUrl = pagePublicUrl(publicSiteUrl, `push-retry-${suffix}`)
    const html = await fetchPublicDocument(publicPageUrl)
    expect(html).toContain(markerAfterRetry)
  } finally {
    await stack.stop()
  }
})

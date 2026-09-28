import { expect, test } from '@playwright/test'
import {
  clickAdminNav,
  createDraftOnWorkspace,
  createSitePageAndOpen,
  registerAndEnterWorkspace,
  runPushExpectPublished,
  savePageDetail,
  setPageBodyHtml,
} from './helpers'
import {
  draftIdFromPageUrl,
  pageIdFromPageUrl,
  readOlpsAccessToken,
  setSandboxBehindPublishedRemote,
} from './e2e-dedicated-api-helpers'
import { startDedicatedE2eStack } from './dedicated-e2e-stack'

test.describe.configure({ mode: 'serial' })

test('Pull 远端中断后页面展示 lastError 且恢复远端后可再次 Pull 并写入 sandbox', async ({
  page,
}) => {
  const stack = await startDedicatedE2eStack('pull-retry')
  process.env.OLPS_API_URL = stack.apiBaseUrl
  try {
    const suffix = Date.now().toString(36)
    const remoteMarker = `E2E_PULL_REMOTE_${suffix}`
    const localHtml = `<p>local-before-pull-${suffix}</p>`

    await page.goto(`${stack.adminBaseUrl}/login`)
    await registerAndEnterWorkspace(page, {
      account: `pull-retry-${suffix}`,
      password: 'E2ePass1!',
      name: 'Pull Retry',
    })
    await createDraftOnWorkspace(page, `Pull 重试 ${suffix}`)
    await createSitePageAndOpen(page, {
      title: `页 ${suffix}`,
      slug: `pull-retry-${suffix}`,
    })
    await setPageBodyHtml(page, localHtml)
    await savePageDetail(page)

    await runPushExpectPublished(page)

    const pageUrl = page.url()
    const draftId = draftIdFromPageUrl(pageUrl)
    const pageId = pageIdFromPageUrl(pageUrl)
    const accessToken = await readOlpsAccessToken(page)

    await setSandboxBehindPublishedRemote({
      apiBaseUrl: stack.apiBaseUrl,
      accessToken,
      draftId,
      pageId,
      remoteHtml: `<h1>${remoteMarker}</h1>`,
      localHtml,
    })

    await clickAdminNav(page, '发布与同步')
    await stack.stopRemoteOnly()

    const pullFailWait = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/drafts\/[^/]+\/pull$/.test(new URL(r.url()).pathname.replace(/\/$/, '')),
      { timeout: 180_000 },
    )
    await page.getByRole('button', { name: 'Pull 远端版本' }).click()
    const pullFailRes = await pullFailWait
    expect(pullFailRes.ok()).toBe(false)

    await expect(page.locator('section.panel p.error').filter({ hasText: /.+/ }).first()).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.locator('.panel p.error').filter({ hasText: /.+/ }).last()).not.toHaveText('')
    await expect(page.getByRole('button', { name: 'Pull 远端版本' })).toBeEnabled()

    await stack.restartRemote()

    const pullOkWait = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/drafts\/[^/]+\/pull$/.test(new URL(r.url()).pathname.replace(/\/$/, '')),
      { timeout: 180_000 },
    )
    await page.getByRole('button', { name: 'Pull 远端版本' }).click()
    const pullOkRes = await pullOkWait
    expect(pullOkRes.ok()).toBe(true)
    await expect(page.locator('p.ok')).toContainText('Pull 已完成，sandbox 已更新', {
      timeout: 60_000,
    })

    await clickAdminNav(page, '页面')
    await page.locator('table.table').getByRole('link', { name: '详情' }).first().click()
    await expect(page.locator('label:has-text("body.html") textarea')).toContainText(remoteMarker, {
      timeout: 60_000,
    })
  } finally {
    await stack.stop()
  }
})

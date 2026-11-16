import { expect, test } from '@playwright/test'
import {
  createDraftOnWorkspace,
  createSitePageAndOpen,
  clickAdminNav,
  registerAndEnterWorkspace,
  requireApiReady,
  runPushExpectPublished,
} from './helpers'

test('报告候选页面：含当前草稿未发布页，不含仅存在于其他草稿的页面', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const mainDraftName = `主草稿 ${suffix}`
  const publishedTitle = `已发布页 ${suffix}`
  const unpublishedTitle = `未发布候选 ${suffix}`
  const otherDraftOnlyTitle = `其他草稿独有 ${suffix}`

  await registerAndEnterWorkspace(page, {
    account: `rcp-${suffix}`,
    password: 'E2ePass1!',
    name: 'Report Candidates',
  })
  await createDraftOnWorkspace(page, mainDraftName)
  await createSitePageAndOpen(page, {
    title: publishedTitle,
    slug: `pub-${suffix}`,
  })
  const { siteName } = await runPushExpectPublished(page)

  await createSitePageAndOpen(page, {
    title: unpublishedTitle,
    slug: `unpub-${suffix}`,
  })

  await clickAdminNav(page, '报告')
  let reportPageSelect = page.locator('label:has-text("页面") select')
  await expect(reportPageSelect).toBeVisible()
  await expect(reportPageSelect.locator('option')).toContainText([unpublishedTitle])
  await expect(reportPageSelect.locator('option')).toContainText([publishedTitle])

  await page.getByRole('button', { name: '切换网站' }).click()
  await createDraftOnWorkspace(page, `副草稿 ${suffix}`, { basedOnSiteName: siteName })
  await createSitePageAndOpen(page, {
    title: otherDraftOnlyTitle,
    slug: `other-${suffix}`,
  })

  await page.getByRole('button', { name: '切换网站' }).click()
  await expect(page).toHaveURL(/\/workspace/)
  await expect(page.locator('p.error[role="alert"]')).toHaveCount(0)
  const mainSite = page.locator('section.site-card').filter({ hasText: mainDraftName })
  const mainDraftBtn = mainSite.getByRole('button', { name: '选择编辑版本', exact: true })
  await expect(mainDraftBtn).toBeVisible({ timeout: 60_000 })
  await mainDraftBtn.click()
  await mainSite.getByRole('button', { name: mainDraftName, exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 })
  await clickAdminNav(page, '报告')
  reportPageSelect = page.locator('label:has-text("页面") select')
  await expect(reportPageSelect.locator('option')).toContainText([unpublishedTitle])
  await expect(reportPageSelect.locator('option')).not.toContainText([otherDraftOnlyTitle])
})

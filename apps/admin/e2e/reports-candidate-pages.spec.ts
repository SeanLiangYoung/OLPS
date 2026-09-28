import { expect, test } from '@playwright/test'
import {
  createDraftOnWorkspace,
  createSitePageAndOpen,
  clickAdminNav,
  registerAndEnterWorkspace,
  requireApiReady,
  runPushExpectPublished,
} from './helpers'

/**
 * 报告页「页面」下拉须反映当前草稿 sandbox 列表，而非仅网站已发布列表或其他草稿独有页面。
 * 依赖真实 API 与 remote；服务未齐时由主控执行本文件，当前阶段无 vitest 级 RED 证据。
 */
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

  await clickAdminNav(page, '页面')
  await page.locator('label:has-text("标题") input').fill(unpublishedTitle)
  await page.locator('label:has-text("slug") input').fill(`unpub-${suffix}`)
  await page.getByRole('button', { name: '创建并打开' }).click()
  await expect(page).toHaveURL(/\/drafts\/[^/]+\/pages\//)

  await clickAdminNav(page, '报告')
  let reportPageSelect = page.locator('label:has-text("页面") select')
  await expect(reportPageSelect).toBeVisible()
  await expect(reportPageSelect.locator('option')).toContainText([unpublishedTitle])
  await expect(reportPageSelect.locator('option')).toContainText([publishedTitle])

  await page.getByRole('button', { name: '切换工作区' }).click()
  await createDraftOnWorkspace(page, `副草稿 ${suffix}`, { basedOnSiteName: siteName })
  await clickAdminNav(page, '页面')
  await page.locator('label:has-text("标题") input').fill(otherDraftOnlyTitle)
  await page.locator('label:has-text("slug") input').fill(`other-${suffix}`)
  await page.getByRole('button', { name: '创建并打开' }).click()

  await page.getByRole('button', { name: '切换工作区' }).click()
  await page.locator('button.workspace-item').filter({ hasText: mainDraftName }).click()
  await clickAdminNav(page, '报告')
  reportPageSelect = page.locator('label:has-text("页面") select')
  await expect(reportPageSelect.locator('option')).toContainText([unpublishedTitle])
  await expect(reportPageSelect.locator('option')).not.toContainText([otherDraftOnlyTitle])
})

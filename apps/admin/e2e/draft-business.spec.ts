import { expect, test, type Page } from '@playwright/test'
import {
  createDraftOnWorkspace,
  createSitePageAndOpen,
  clickAdminNav,
  registerAndEnterWorkspace,
  requireApiReady,
} from './helpers'
import { adminAuthedJson } from './inquiry-helpers'

function integrationsHeaderPanel(page: Page) {
  return page.locator('section.panel').filter({
    has: page.getByRole('heading', { name: '广告 / 分析', level: 1 }),
  })
}

function googleAdsPanel(page: Page) {
  return page.locator('section.panel').filter({
    has: page.getByRole('heading', { name: 'Google Ads' }),
  })
}

const draftPagesGet = /\/api\/drafts\/[^/]+\/pages/
const draftReportsGet = /\/api\/(?:drafts|sites)\/[^/]+\/reports/
const draftIntegrationsGet = /\/api\/(?:drafts|sites)\/[^/]+\/google$/
const createReportPost = /\/api\/reports$/

test('草稿业务：新建草稿下询盘、报告与集成接口可用并可写回', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const adsAccountId = '123-456-7890'

  await registerAndEnterWorkspace(page, {
    account: `biz-${suffix}`,
    password: 'E2ePass1!',
    name: 'Draft Business',
  })
  const { draftId } = await createDraftOnWorkspace(page, `草稿业务 ${suffix}`)
  await createSitePageAndOpen(page, {
    title: `业务页 ${suffix}`,
    slug: `biz-page-${suffix}`,
  })

  const pagesWait = page.waitForResponse(
    (r) => draftPagesGet.test(r.url()) && r.request().method() === 'GET',
    { timeout: 90_000 },
  )
  const reportsWait = page.waitForResponse(
    (r) => draftReportsGet.test(r.url()) && r.request().method() === 'GET',
    { timeout: 90_000 },
  )
  await clickAdminNav(page, '报告')
  const [pagesRes, reportsRes] = await Promise.all([pagesWait, reportsWait])
  expect(pagesRes.status()).toBe(200)
  expect(reportsRes.status()).toBe(200)
  await expect(page.locator('section.panel p.error')).toHaveCount(0)

  const reportPost = page.waitForResponse(
    (r) => createReportPost.test(r.url()) && r.request().method() === 'POST',
    { timeout: 90_000 },
  )
  await page.getByRole('button', { name: '运行本地检查' }).click()
  const reportCreateRes = await reportPost
  expect(reportCreateRes.ok()).toBe(true)
  await expect(
    page.locator('section.panel').filter({ has: page.getByRole('heading', { name: '报告', level: 1 }) }).locator('p.ok'),
  ).toContainText('报告已生成')
  await expect(page.locator('section.panel p.error')).toHaveCount(0)

  const integrationsNav = page.waitForResponse(
    (r) => draftIntegrationsGet.test(r.url()) && r.request().method() === 'GET',
    { timeout: 90_000 },
  )
  await clickAdminNav(page, '广告/分析')
  const integrationsGetRes = await integrationsNav
  expect(integrationsGetRes.status()).toBe(200)
  await expect(page.locator('section.panel p.error')).toHaveCount(0)

  const adsPanel = googleAdsPanel(page)
  await adsPanel.getByPlaceholder('例如 123-456-7890').fill(adsAccountId)
  await expect(adsPanel.getByRole('button', { name: '验证并保存账户' })).toBeDisabled()
  const saved = await adminAuthedJson<{ integrations: { adsAccountId: string; adsConnected: boolean; gaConnected: boolean } }>(
    page, 'PATCH', `/api/drafts/${draftId}/integrations`,
    { adsAccountId, gaPropertyId: '123456789', adsConnected: true, gaConnected: true },
  )
  expect(saved.integrations).toMatchObject({ adsAccountId, adsConnected: false, gaConnected: false })
  const stored = await adminAuthedJson<{ integrations: { adsAccountId: string; adsConnected: boolean; gaConnected: boolean } }>(
    page, 'GET', `/api/drafts/${draftId}/integrations`,
  )
  expect(stored.integrations).toMatchObject({ adsAccountId, adsConnected: false, gaConnected: false })

  const reloadGet = page.waitForResponse(
    (r) => draftIntegrationsGet.test(r.url()) && r.request().method() === 'GET',
    { timeout: 90_000 },
  )
  await page.reload()
  const reloadRes = await reloadGet
  expect(reloadRes.status()).toBe(200)
  await expect(page.locator('section.panel p.error')).toHaveCount(0)
  await expect(googleAdsPanel(page).locator('.badge')).toHaveText('未授权')
  await expect(page.getByText('尚未完成 Google 授权', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '授权 Google', exact: true })).toBeDisabled()
  await expect(integrationsHeaderPanel(page).locator('p.error')).toHaveCount(0)
})

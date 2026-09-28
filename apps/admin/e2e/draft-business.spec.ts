import { expect, test } from '@playwright/test'
import {
  clickNavAndWaitGet200,
  createDraftOnWorkspace,
  createSitePageAndOpen,
  expectNoPanelError,
  registerAndEnterWorkspace,
  requireApiReady,
} from './helpers'

const draftInquiriesGet = /\/api\/drafts\/[^/]+\/inquiries/
const draftReportsGet = /\/api\/drafts\/[^/]+\/reports/
const draftPagesGet = /\/api\/drafts\/[^/]+\/pages/
const draftIntegrationsGet = /\/api\/drafts\/[^/]+\/integrations/
const createReportPost = /\/api\/reports$/
const integrationsPatch = /\/api\/drafts\/[^/]+\/integrations$/

test('草稿业务：新建草稿下询盘、报告与集成接口可用并可写回', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const adsAccountId = `e2e-ads-${suffix}`

  await registerAndEnterWorkspace(page, {
    account: `biz-${suffix}`,
    password: 'E2ePass1!',
    name: 'Draft Business',
  })
  await createDraftOnWorkspace(page, `草稿业务 ${suffix}`)
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
  await page.getByRole('link', { name: '报告' }).click()
  const [pagesRes, reportsRes] = await Promise.all([pagesWait, reportsWait])
  expect(pagesRes.status()).toBe(200)
  expect(reportsRes.status()).toBe(200)
  await expectNoPanelError(page)

  const reportPost = page.waitForResponse(
    (r) => createReportPost.test(r.url()) && r.request().method() === 'POST',
    { timeout: 90_000 },
  )
  await page.getByRole('button', { name: '运行报告' }).click()
  const reportCreateRes = await reportPost
  expect(reportCreateRes.ok()).toBe(true)
  await expect(page.locator('p.ok')).toContainText('报告已生成')
  await expectNoPanelError(page)

  await clickNavAndWaitGet200(page, '广告 / 分析', draftIntegrationsGet)
  await expectNoPanelError(page)
  await page.getByPlaceholder('例如 123-456-7890').fill(adsAccountId)
  const patchPromise = page.waitForResponse(
    (r) => integrationsPatch.test(r.url()) && r.request().method() === 'PATCH',
    { timeout: 90_000 },
  )
  await page.getByRole('button', { name: '绑定 / 更新' }).click()
  const patchRes = await patchPromise
  expect(patchRes.status()).toBe(200)
  await expect(page.locator('p.ok')).toContainText('已保存')

  const reloadGet = page.waitForResponse(
    (r) => draftIntegrationsGet.test(r.url()) && r.request().method() === 'GET',
    { timeout: 90_000 },
  )
  await page.reload()
  const reloadRes = await reloadGet
  expect(reloadRes.status()).toBe(200)
  await expectNoPanelError(page)
  await expect(page.getByPlaceholder('例如 123-456-7890')).toHaveValue(adsAccountId)

  await clickNavAndWaitGet200(page, '询盘', draftInquiriesGet)
  await expectNoPanelError(page)
})

import { expect, test } from '@playwright/test'
import {
  clickAdminNav, createDraftOnWorkspace, createSitePageAndOpen, pagePublicUrl,
  registerAndEnterWorkspace, requireApiReady, runPushExpectPublished,
  savePageDetail,
  openDetailSection,
} from './helpers'

test('后台选择发布范围、恢复发布和删除页面', async ({ page, request }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await registerAndEnterWorkspace(page, { account: `lifecycle-${suffix}`, password: 'E2ePass1!', name: 'Lifecycle' })
  await createDraftOnWorkspace(page, `Lifecycle ${suffix}`)
  const slug = `article-${suffix}`
  await createSitePageAndOpen(page, { title: `Article ${suffix}`, slug })
  const detailUrl = page.url()
  const { publicSiteUrl } = await runPushExpectPublished(page)
  const publicUrl = pagePublicUrl(publicSiteUrl, slug)
  expect((await request.get(publicUrl)).status()).toBe(200)

  await page.goto(detailUrl)
  await page.getByRole('button', { name: '暂停发布此页', exact: true }).click()
  await expect(page.getByText('已暂停发布，执行 Push 后生效', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '写预览', exact: true }).click()
  await expect(page.locator('iframe[title="page-preview"]')).toBeVisible()
  await runPushExpectPublished(page)
  expect((await request.get(publicUrl)).status()).toBe(404)

  await page.goto(detailUrl)
  await page.getByRole('button', { name: '加入发布范围', exact: true }).click()
  await expect(page.getByText('已加入发布范围，执行 Push 后生效', { exact: true })).toBeVisible()
  await runPushExpectPublished(page)
  expect((await request.get(publicUrl)).status()).toBe(200)

  await page.goto(detailUrl)
  await page.getByRole('button', { name: '删除页面', exact: true }).click()
  await page.getByRole('button', { name: '确认删除页面', exact: true }).click()
  await expect(page).toHaveURL(/\/pages$/)
  await expect(page.locator('table.table')).toContainText('等待删除')
  await clickAdminNav(page, '发布与同步')
  await runPushExpectPublished(page)
  expect((await request.get(publicUrl)).status()).toBe(404)
})

test('两个编辑窗口保存同一页面时保留已经保存的修改', async ({ page, context }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await registerAndEnterWorkspace(page, { account: `concurrent-${suffix}`, password: 'E2ePass1!', name: 'Concurrent' })
  await createDraftOnWorkspace(page, `Concurrent ${suffix}`)
  await createSitePageAndOpen(page, { title: 'Original', slug: `concurrent-${suffix}` })
  const second = await context.newPage()
  try {
    await second.goto(page.url())
    await expect(second.getByRole('heading', { name: 'Original', exact: true })).toBeVisible()
    await openDetailSection(second, '页面信息与 SEO')
    await second.getByLabel('标题', { exact: true }).fill('Updated in second window')
    await savePageDetail(second)
    await openDetailSection(page, '页面信息与 SEO')
    await page.getByLabel('标题', { exact: true }).fill('Outdated first window')
    await page.getByRole('button', { name: '保存页面', exact: true }).click()
    await expect(page.getByText('页面已更新，请重新加载后保存', { exact: true })).toBeVisible()
    await page.reload()
    await openDetailSection(page, '页面信息与 SEO')
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue('Updated in second window')
  } finally {
    await second.close()
  }
})

import { expect, test } from '@playwright/test'
import {
  clickAdminNav,
  createDraftOnWorkspace,
  fetchPublicDocument,
  pagePublicUrl,
  registerAndEnterWorkspace,
  requireApiReady,
  runPushExpectPublished,
} from './helpers'

// 真实调用 api 配置的模型接口（AI_API_KEY），单次生成或修改可能需要数分钟
const AI_STEP_TIMEOUT_MS = 600_000

test('AI 生成页面 → AI 按指令修改 → 预览 → Push 后线上可见', async ({ page }) => {
  test.setTimeout(1_800_000)
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const slug = `ai-contact-${suffix}`
  const revisedHeading = `Talk To Our Team ${suffix}`

  await registerAndEnterWorkspace(page, {
    account: `ai-${suffix}`,
    password: 'E2ePass1!',
    name: 'AI E2E',
  })
  await createDraftOnWorkspace(page, `AI 站点 ${suffix}`)

  await clickAdminNav(page, 'AI 生成')
  await page.locator('label:has-text("类型") select').selectOption('site')
  await page.locator('label:has-text("标题") input').fill('Contact Us')
  await page.locator('label:has-text("slug") input').fill(slug)
  await page
    .locator('label:has-text("页面需求") textarea')
    .fill('Contact page for a stainless steel pipe supplier. Include an inquiry form so visitors can send us a message.')
  const generateWait = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/jobs/generate_page',
    { timeout: AI_STEP_TIMEOUT_MS },
  )
  await page.getByRole('button', { name: 'AI 生成页面' }).click()
  await expect(page.getByRole('button', { name: 'AI 生成中…' })).toBeVisible()
  const generateRes = await generateWait
  expect(generateRes.status(), await generateRes.text()).toBe(201)

  await expect(page).toHaveURL(/\/drafts\/[^/]+\/pages\//, { timeout: 60_000 })
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  const htmlEditor = page.locator('label:has-text("body.html") textarea')
  await expect(htmlEditor).toHaveValue(/data-olps-inquiry/)
  await expect(page.locator('label:has-text("SEO title") input')).not.toHaveValue('')

  await page
    .locator('label:has-text("修改指令") textarea')
    .fill(`Change the text of the h1 heading to exactly "${revisedHeading}". Keep everything else unchanged.`)
  const reviseWait = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/jobs/revise_page',
    { timeout: AI_STEP_TIMEOUT_MS },
  )
  await page.getByRole('button', { name: 'AI 修改', exact: true }).click()
  await expect(page.getByRole('button', { name: 'AI 修改中…' })).toBeVisible()
  await expect(htmlEditor).toBeDisabled()
  const reviseRes = await reviseWait
  expect(reviseRes.status(), await reviseRes.text()).toBe(201)

  await expect(page.getByText('AI 修改已写入草稿，预览已更新')).toBeVisible({ timeout: 90_000 })
  await expect(htmlEditor).toBeEnabled()
  await expect(htmlEditor).toHaveValue(new RegExp(revisedHeading))
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  await expect(page.locator('label:has-text("修改指令") textarea')).toHaveValue('')
  const frame = page.frameLocator('iframe[title="page-preview"]')
  await expect(frame.locator('h1')).toHaveText(revisedHeading, { timeout: 60_000 })
  await expect(frame.locator('form[data-olps-inquiry]')).toHaveCount(1)

  const { publicSiteUrl } = await runPushExpectPublished(page)
  const publicHtml = await fetchPublicDocument(pagePublicUrl(publicSiteUrl, slug))
  expect(publicHtml).toContain(revisedHeading)
  expect(publicHtml).toContain('data-olps-inquiry')
})

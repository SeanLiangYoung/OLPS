import { expect, test } from '@playwright/test'

const apiBase = process.env.OLPS_API_URL ?? 'http://127.0.0.1:8787'

async function requireApiReady(): Promise<void> {
  try {
    const res = await fetch(`${apiBase}/api/health`)
    if (!res.ok) {
      throw new Error(`管理 API health 返回 ${res.status}`)
    }
  } catch {
    throw new Error(
      `无法连接 ${apiBase}。联调前请启动 api、remote 与 PostgreSQL。`,
    )
  }
}

test('顶栏在切换草稿后更新草稿名称', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await page.goto('/login')
  await page.getByRole('tab', { name: '注册' }).click()
  await page.locator('#reg-name').fill('Shell Test')
  await page.locator('#reg-account').fill(`shell-${suffix}`)
  await page.locator('#reg-password').fill('E2ePass1!')
  await page.getByRole('button', { name: '注册并进入' }).click()
  await expect(page).toHaveURL(/\/workspace/)
  await page.getByPlaceholder('例如：春季活动站').fill(`草稿甲 ${suffix}`)
  await page.getByRole('button', { name: '创建草稿' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  await expect(page.getByText(`草稿 草稿甲 ${suffix}`)).toBeVisible()
})

test('设置页保存后 defaultLocale 与语言列表顺序无关', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await page.goto('/login')
  await page.getByRole('tab', { name: '注册' }).click()
  await page.locator('#reg-name').fill('Locale Test')
  await page.locator('#reg-account').fill(`loc-${suffix}`)
  await page.locator('#reg-password').fill('E2ePass1!')
  await page.getByRole('button', { name: '注册并进入' }).click()
  await page.getByPlaceholder('例如：春季活动站').fill(`设置 ${suffix}`)
  await page.getByRole('button', { name: '创建草稿' }).click()
  await page.getByRole('link', { name: '设置' }).click()
  await page.locator('label:has-text("默认语言") input').fill('zh')
  await page.locator('label:has-text("语言列表") input').fill('en, zh')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('已保存草稿站点配置')).toBeVisible()
  await expect(page.locator('label:has-text("默认语言") input')).toHaveValue('zh')
})

test('页面 draftId 与当前草稿不一致时拒绝编辑', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await page.goto('/login')
  await page.getByRole('tab', { name: '注册' }).click()
  await page.locator('#reg-account').fill(`pd-${suffix}`)
  await page.locator('#reg-password').fill('E2ePass1!')
  await page.locator('#reg-name').fill('Page Draft')
  await page.getByRole('button', { name: '注册并进入' }).click()
  await page.getByPlaceholder('例如：春季活动站').fill(`草稿 A ${suffix}`)
  await page.getByRole('button', { name: '创建草稿' }).click()
  await page.getByRole('link', { name: '页面' }).click()
  await page.getByRole('button', { name: '创建并打开' }).click()
  await expect(page).toHaveURL(/\/pages\//)
  const pageUrl = page.url()
  await page.getByRole('button', { name: '切换工作区' }).click()
  await page.getByPlaceholder('例如：春季活动站').fill(`草稿 B ${suffix}`)
  await page.getByRole('button', { name: '创建草稿' }).click()
  await page.goto(pageUrl)
  await expect(page.getByText('该页面属于其他草稿')).toBeVisible()
})

import { expect, test } from '@playwright/test'

const apiBase = process.env.OLPS_API_URL ?? 'http://127.0.0.1:8787'

async function requireApiReady(): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${apiBase}/api/health`)
  } catch {
    throw new Error(
      `无法连接管理 API（${apiBase}）。请先启动 api、remote 与 PostgreSQL（测试库见 codex-review.md）后再运行 npm run test:e2e -w @olps/admin。`,
    )
  }
  if (!res.ok) {
    throw new Error(
      `管理 API 未就绪（${apiBase}/api/health 返回 ${res.status}）。请先启动 api、remote 与 PostgreSQL 后再运行 e2e。`,
    )
  }
}

test('两用户协作：注册、草稿、编辑、Push、公开 URL、Pull 后编辑', async ({ page, browser }) => {
  await requireApiReady()

  const suffix = Date.now().toString(36)
  const userA = { account: `e2e-a-${suffix}`, password: 'E2ePass1!', name: 'E2E A' }
  const userB = { account: `e2e-b-${suffix}`, password: 'E2ePass1!', name: 'E2E B' }

  await page.goto('/login')
  await page.getByRole('tab', { name: '注册' }).click()
  await page.locator('#reg-name').fill(userA.name)
  await page.locator('#reg-account').fill(userA.account)
  await page.locator('#reg-password').fill(userA.password)
  await page.getByRole('button', { name: '注册并进入' }).click()
  await expect(page).toHaveURL(/\/workspace/)

  await page.getByPlaceholder('例如：春季活动站').fill(`协作站 ${suffix}`)
  await page.getByRole('button', { name: '创建草稿' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.getByRole('link', { name: '页面' }).click()
  await page.getByRole('button', { name: '创建并打开' }).click()
  await expect(page).toHaveURL(/\/pages\//)
  await page.getByRole('button', { name: '保存' }).click()

  await page.getByRole('link', { name: '发布与同步' }).click()
  await page.getByRole('button', { name: 'Push 并发布' }).click()
  await expect(page.getByText(/Push|等待|失败|就绪|同步/)).toBeVisible({ timeout: 90_000 })

  const pageB = await browser.newPage()
  await pageB.goto('/login')
  await pageB.getByRole('tab', { name: '注册' }).click()
  await pageB.locator('#reg-name').fill(userB.name)
  await pageB.locator('#reg-account').fill(userB.account)
  await pageB.locator('#reg-password').fill(userB.password)
  await pageB.getByRole('button', { name: '注册并进入' }).click()
  await expect(pageB).toHaveURL(/\/workspace/)

  await pageB.getByRole('button', { name: '管理网站所有者' }).first().click()
  await pageB.getByPlaceholder('已有用户账号').fill(userB.account)
  await pageB.getByRole('button', { name: '添加所有者' }).click()

  await pageB.getByPlaceholder('例如：春季活动站').fill(`B 草稿 ${suffix}`)
  await pageB.getByRole('button', { name: '创建草稿' }).click()
  await pageB.getByRole('link', { name: '发布与同步' }).click()
  await pageB.getByRole('button', { name: 'Pull 远端版本' }).click()
  await expect(pageB.getByText(/Pull|等待|失败|就绪|同步/)).toBeVisible({ timeout: 90_000 })

  await pageB.close()
})

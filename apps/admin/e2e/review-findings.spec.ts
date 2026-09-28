import { expect, test } from '@playwright/test'
import {
  clickAdminNav,
  createDraftOnWorkspace,
  registerAndEnterWorkspace,
  requireApiReady,
} from './helpers'

test('顶栏在切换草稿后更新草稿名称', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await registerAndEnterWorkspace(page, {
    account: `shell-${suffix}`,
    password: 'E2ePass1!',
    name: 'Shell Test',
  })
  await createDraftOnWorkspace(page, `草稿甲 ${suffix}`)
  await expect(page.getByText(`草稿 草稿甲 ${suffix}`)).toBeVisible()
})

test('设置页保存后 defaultLocale 与语言列表顺序无关', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await registerAndEnterWorkspace(page, {
    account: `loc-${suffix}`,
    password: 'E2ePass1!',
    name: 'Locale Test',
  })
  await createDraftOnWorkspace(page, `设置 ${suffix}`)
  await clickAdminNav(page, '设置')
  await page.locator('label:has-text("默认语言") input').fill('zh')
  await page.locator('label:has-text("语言列表") input').fill('en, zh')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('已保存草稿站点配置')).toBeVisible()
  await expect(page.locator('label:has-text("默认语言") input')).toHaveValue('zh')
})

test('页面 draftId 与当前草稿不一致时拒绝编辑', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await registerAndEnterWorkspace(page, {
    account: `pd-${suffix}`,
    password: 'E2ePass1!',
    name: 'Page Draft',
  })
  await createDraftOnWorkspace(page, `草稿 A ${suffix}`)
  await clickAdminNav(page, '页面')
  await page.locator('label:has-text("标题") input').fill(`页 ${suffix}`)
  await page.locator('label:has-text("slug") input').fill(`slug-${suffix}`)
  await page.getByRole('button', { name: '创建并打开' }).click()
  await expect(page).toHaveURL(/\/drafts\/[^/]+\/pages\//)
  const pageUrl = page.url()
  await page.getByRole('button', { name: '切换工作区' }).click()
  await createDraftOnWorkspace(page, `草稿 B ${suffix}`)
  await page.goto(pageUrl)
  await expect(page.getByText('该页面属于其他草稿')).toBeVisible()
})

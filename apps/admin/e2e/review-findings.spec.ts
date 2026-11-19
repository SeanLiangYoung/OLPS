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
  const settingsPatch = page.waitForResponse(
    (r) => {
      if (r.request().method() !== 'PATCH') return false
      return /\/api\/drafts\/[^/]+\/settings$/.test(new URL(r.url()).pathname.replace(/\/$/, ''))
    },
    { timeout: 90_000 },
  )
  await page.getByRole('button', { name: '保存' }).click()
  const patchRes = await settingsPatch
  expect(patchRes.status()).toBe(200)
  const patchReqBody = patchRes.request().postDataJSON() as {
    defaultLocale?: string
    locales?: string[]
    settings?: unknown
  }
  expect(patchReqBody.settings).toBeUndefined()
  expect(patchReqBody.defaultLocale).toBe('zh')
  expect(patchReqBody.locales).toEqual(['en', 'zh'])
  const patchBody = (await patchRes.json()) as {
    draft?: { settings?: { defaultLocale?: string; locales?: string[] } }
  }
  expect(patchBody.draft?.settings?.defaultLocale).toBe('zh')
  expect(patchBody.draft?.settings?.locales).toEqual(['en', 'zh'])
  await expect(page.getByText('已保存草稿站点配置')).toBeVisible()
  await expect(page.locator('label:has-text("默认语言") input')).toHaveValue('zh')
  await expect(page.locator('label:has-text("语言列表") input')).toHaveValue('en, zh')

  const draftGet = page.waitForResponse(
    (r) => r.request().method() === 'GET' && /\/api\/drafts\/[^/]+$/.test(new URL(r.url()).pathname.replace(/\/$/, '')),
    { timeout: 90_000 },
  )
  await page.reload()
  await draftGet
  await expect(page.locator('label:has-text("默认语言") input')).toHaveValue('zh')
  await expect(page.locator('label:has-text("语言列表") input')).toHaveValue('en, zh')
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
  const mismatchText = '该页面属于其他草稿，请在工作区切换到对应草稿后再编辑'
  await expect(page.getByRole('alert')).toHaveText(mismatchText)
  await expect(page.locator('label:has-text("body.html") textarea')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
})

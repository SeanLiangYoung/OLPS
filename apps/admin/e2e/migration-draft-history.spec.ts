import { expect, test } from '@playwright/test'
import {
  clickAdminNav,
  createDraftOnWorkspace,
  registerAndEnterWorkspace,
  requireApiReady,
} from './helpers'

/**
 * 依赖 migration-api.md 中的 draft 作用域接口。
 * 管理 API 未实现时会在数据加载处失败；scope 文案与路由行为仍应先通过 DOM 断言。
 */
test('未发布草稿展示草稿历史作用域，不提示必须先发布网站', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await registerAndEnterWorkspace(page, {
    account: `mig-${suffix}`,
    password: 'E2ePass1!',
    name: 'Migration UI',
  })
  await createDraftOnWorkspace(page, `迁移草稿 ${suffix}`)

  await clickAdminNav(page, '询盘')
  await expect(page.getByText('当前草稿的询盘。')).toBeVisible()
  await expect(page.getByText('请先发布网站')).toHaveCount(0)

  await clickAdminNav(page, '报告')
  await expect(page.getByText('当前草稿的报告和页面。')).toBeVisible()
  await expect(page.getByText('请先发布网站')).toHaveCount(0)

  await clickAdminNav(page, '广告/分析')
  await expect(page.getByText('当前草稿的广告与分析绑定。')).toBeVisible()
  await expect(page.getByText('请先发布网站')).toHaveCount(0)

  await clickAdminNav(page, '总览')
  await expect(page.getByRole('link', { name: '客户询盘', exact: false }).last()).toBeVisible()
})

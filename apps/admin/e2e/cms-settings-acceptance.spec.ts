import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { cmsWebsite, selectCmsWebsite } from './cms-fixtures'

const apiBase = process.env.OLPS_API_URL ?? 'http://127.0.0.1:8787'
const execute = promisify(execFile)

test('内容类型修改会列出受影响的分组和条目并打开对应编辑页', async ({ page, request }) => {
  const website = await cmsWebsite(request, apiBase)
  await selectCmsWebsite(page, website)
  const draftPath = `${apiBase}/api/drafts/${website.draftId}`
  const headers = website.identity.headers
  const list = await request.get(`${draftPath}/collections?locale=en`, { headers })
  expect(list.ok(), await list.text()).toBe(true)
  const { collections } = await list.json() as { collections: Array<{ meta: { collectionId: string; prefix: string; name: string; levels: Array<{ levelId: string }> } }> }
  const { collectionId, name, levels } = collections.find(collection => collection.meta.prefix === 'products')!.meta
  const collectionPath = `${draftPath}/collections/${collectionId}`
  const groupId = randomUUID()
  const itemId = randomUUID()
  const timestamp = new Date().toISOString()
  const commonMeta = { schemaVersion: 1, status: 'draft', order: 0, createdAt: timestamp, updatedAt: timestamp }
  const commonLocale = { schemaVersion: 1, summary: '', cover: null, seo: { title: '', description: '', ogImage: null }, blocks: [], sourceHash: null, updatedAt: timestamp }
  const group = await request.post(`${collectionPath}/groups`, { headers, data: {
    ref: 'group', collectionId,
    meta: { ...commonMeta, groupId, levelId: levels[0].levelId, parentGroupId: null },
    locale: { ...commonLocale, locale: 'en', title: '验收受影响分组', slug: 'affected-group' },
  } })
  expect(group.status(), await group.text()).toBe(201)
  const item = await request.post(`${collectionPath}/items`, { headers, data: {
    ref: 'item', collectionId,
    meta: { ...commonMeta, itemId, primaryGroupId: groupId, groupIds: [groupId], publishedAt: null, fields: { model: 'SET-1' } },
    locale: { ...commonLocale, locale: 'zh-CN', title: '验收受影响条目', slug: 'affected-item', fields: {} },
  } })
  expect(item.status(), await item.text()).toBe(201)

  await page.goto('/settings/content-types')
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: '删除层级', exact: true }).first().click()
  const rejected = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/content/collection/${collectionId}`))
  await page.getByRole('button', { name: '保存内容类型', exact: true }).click()
  const response = await rejected
  expect(response.status(), await response.text()).toBe(409)
  const error = await response.json()
  expect(error.code).toBe('RESOURCE_IN_USE')
  expect(error.details.objects).toEqual(expect.arrayContaining([{ ref: 'group', id: groupId }, { ref: 'item', id: itemId }]))
  await expect(page.getByRole('alert')).toContainText('1 个分组和 1 个条目')
  const groupLink = page.getByRole('link', { name: /验收受影响分组/ })
  const itemLink = page.getByRole('link', { name: /验收受影响条目/ })
  await expect(groupLink).toHaveAttribute('href', new RegExp(`/content/group/${groupId}\\?locale=en(?:&|$)`))
  await expect(itemLink).toHaveAttribute('href', new RegExp(`/content/item/${itemId}\\?locale=zh-CN(?:&|$)`))
  await itemLink.click()
  await expect(page).toHaveURL(new RegExp(`/content/item/${itemId}\\?locale=zh-CN(?:&|$)`))
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('验收受影响条目')
})

test('从菜单进入所有设置页面并管理真实主题与含密钥的插件', async ({ page, request }) => {
  const website = await cmsWebsite(request, apiBase)
  await selectCmsWebsite(page, website)
  await page.goto('/dashboard')
  const nav = page.getByRole('navigation', { name: '网站管理导航' })
  const sections = [
    ['常规设置', '/settings/general', '常规设置'],
    ['搜索设置', '/settings/search', '搜索设置'],
    ['内容类型设置', '/settings/content-types', '内容类型'],
    ['发布目标', '/settings/targets', '发布目标'],
    ['网站成员', '/settings/members', '成员管理'],
    ['外观定制', '/appearance/customize', '自定义外观'],
    ['导航菜单', '/appearance/menus', '菜单'],
    ['固定文字', '/appearance/texts', '固定文字'],
    ['插件', '/plugins', '插件'],
    ['主题', '/appearance/themes', '主题'],
  ]
  for (const [link, address, title] of sections) {
    await nav.getByRole('link', { name: link, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${address}$`))
    await expect(page.getByRole('heading', { name: title, level: 1, exact: true })).toBeVisible()
  }

  const parent = path.resolve('../../.intermediate/cms-settings-packages')
  await fs.mkdir(parent, { recursive: true })
  const temporary = await fs.mkdtemp(path.join(parent, 'test-'))
  try {
    const theme = path.join(temporary, 'theme')
    const plugin = path.join(temporary, 'plugin')
    await fs.mkdir(path.join(theme, 'templates'), { recursive: true })
    await fs.mkdir(plugin)
    const packageFields = { schemaVersion: 1, version: '1.0.0', author: 'OLPS', description: '', requires: '1' }
    const themeName = '验收主题'
    const pluginName = '验收插件'
    await fs.writeFile(path.join(theme, 'theme.json'), JSON.stringify({ ...packageFields, id: 'acceptance-theme', name: themeName, settings: [], menus: [], templates: [], styles: [] }))
    for (const file of ['page', 'collection', 'group', 'item']) {
      await fs.writeFile(path.join(theme, 'templates', `${file}.liquid`), '<!doctype html><html><head><title>{{ seo.title }}</title></head><body><main>{{ content }}</main></body></html>')
    }
    await fs.writeFile(path.join(plugin, 'plugin.json'), JSON.stringify({
      ...packageFields, id: 'acceptance-plugin', name: pluginName,
      settings: [{ key: 'apiKey', label: 'API 密钥', type: 'secret', required: false, translatable: false }],
      snippets: [], assets: [], server: {}, permissions: {},
    }))
    const themeZip = path.join(temporary, 'theme.zip')
    const pluginZip = path.join(temporary, 'plugin.zip')
    await execute('zip', ['-q', '-r', themeZip, '.'], { cwd: theme })
    await execute('zip', ['-q', '-r', pluginZip, '.'], { cwd: plugin })

    const themeUpload = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/themes'))
    await page.getByLabel('安装主题压缩包', { exact: true }).setInputFiles(themeZip)
    const installedTheme = await themeUpload
    expect(installedTheme.status(), await installedTheme.text()).toBe(201)
    await expect(page.getByRole('status')).toHaveText('主题已经安装')
    const uploadedTheme = page.locator('article').filter({ has: page.getByRole('heading', { name: themeName, exact: true }) })
    const starterTheme = page.locator('article').filter({ has: page.getByRole('heading', { name: '基础主题', exact: true }) })
    await uploadedTheme.getByRole('button', { name: '启用主题', exact: true }).click()
    await expect(uploadedTheme).toContainText('当前主题')
    await expect(starterTheme).toContainText('尚未启用')
    await starterTheme.getByRole('button', { name: '启用主题', exact: true }).click()
    await expect(starterTheme).toContainText('当前主题')
    await expect(uploadedTheme).toContainText('尚未启用')

    await nav.getByRole('link', { name: '插件', exact: true }).click()
    const pluginInput = page.getByLabel('安装插件压缩包', { exact: true })
    await expect(pluginInput).toBeEnabled()
    const pluginUpload = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/plugins'))
    await pluginInput.setInputFiles(pluginZip)
    const installedPlugin = await pluginUpload
    expect(installedPlugin.status(), await installedPlugin.text()).toBe(201)
    await expect(page.getByRole('status')).toHaveText('插件已经安装')
    const uploadedPlugin = page.locator('article').filter({ has: page.getByRole('heading', { name: pluginName, exact: true }) })
    await uploadedPlugin.getByRole('button', { name: '启用', exact: true }).click()
    await expect(uploadedPlugin).toContainText('已启用')
    await uploadedPlugin.getByRole('button', { name: '设置', exact: true }).click()
    const secret = randomUUID()
    await page.getByLabel('API 密钥', { exact: true }).fill(secret)
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('插件设置已保存')
    await page.reload()
    await uploadedPlugin.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByText('已经配置，填写新值可以更换', { exact: true })).toBeVisible()
    await expect(page.getByLabel('API 密钥', { exact: true })).toHaveValue('')
    await uploadedPlugin.getByRole('button', { name: '停用', exact: true }).click()
    await expect(uploadedPlugin).toContainText('已停用')
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
})

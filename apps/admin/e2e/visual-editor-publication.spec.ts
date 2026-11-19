import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const apiBase = process.env.OLPS_API_URL || 'http://127.0.0.1:8787'
test.use({ actionTimeout: 20_000 })

async function requestJson(request: APIRequestContext, method: string, path: string, token: string, data?: unknown) {
  const response = await request.fetch(apiBase + path, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, data })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function clickCanvasContent(page: Page, selector: string) {
  await page.getByRole('region', { name: '可视化页面编辑器' }).evaluate(element => { element.scrollIntoView({ block: 'start' }); window.scrollBy(0, -100) })
  const point = await page.locator('.gjs-frame').evaluate((element, selector) => {
    const frame = element as HTMLIFrameElement
    const target = frame.contentDocument!.querySelector(selector)!
    const frameBounds = frame.getBoundingClientRect()
    const bounds = target.getBoundingClientRect()
    return { x: frameBounds.x + (bounds.x + Math.min(20, bounds.width / 2)) * frameBounds.width / frame.clientWidth, y: frameBounds.y + (bounds.y + Math.min(20, bounds.height / 2)) * frameBounds.height / frame.clientHeight }
  }, selector)
  await page.mouse.click(point.x, point.y)
}

test('可视化正文编辑、图片上传、区域操作与原文保留', async ({ page, request }) => {
  page.on('pageerror', error => console.error(error.stack))
  const suffix = Date.now().toString(36)
  const registered = await requestJson(request, 'POST', '/api/auth/register', '', { account: `visual-${suffix}`, password: 'VisualEditor123!', name: '编辑器检查' })
  const token = registered.accessToken
  const created = await requestJson(request, 'POST', '/api/drafts', token, { name: `编辑器网站 ${suffix}` })
  const draftId = created.draft.draftId
  const createdPage = await requestJson(request, 'POST', `/api/drafts/${draftId}/pages`, token, { kind: 'site', title: '编辑器页面', slug: `visual-${suffix}` })
  const pageId = createdPage.page.pageId
  const original = `<style>.original { color: rgb(33, 44, 55); }</style>\n<section id='intro'><h1 class="original">原始标题</h1><p>保留介绍</p><img alt="产品图片" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="></section>\n<script>window.editorUnknownScriptExecuted=true</script><custom-widget data-value='keep'></custom-widget>`
  await requestJson(request, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}/editor`, token, { body: { html: original }, expectedUpdatedAt: createdPage.page.updatedAt })
  await page.addInitScript(({ token, draftId }) => { if (window !== window.top) return; localStorage.setItem('olps_access_token', token); localStorage.setItem('olps_draft_id', draftId) }, { token, draftId })
  await page.goto(`/drafts/${draftId}/pages/${pageId}`)
  const editor = page.getByRole('region', { name: '可视化页面编辑器' })
  const frame = page.frameLocator('.gjs-frame')
  await expect(frame.getByRole('heading', { name: '原始标题' })).toBeVisible()
  expect(await frame.locator('body').evaluate(() => (window as unknown as { editorUnknownScriptExecuted?: boolean }).editorUnknownScriptExecuted)).toBeUndefined()
  await expect(page.locator('.gjs-frame')).toHaveCSS('width', '1100px')
  await clickCanvasContent(page, 'h1')
  await page.getByLabel('文字内容', { exact: true }).fill('修改后的标题')
  await page.getByLabel('文字内容', { exact: true }).blur()
  await expect(frame.getByRole('heading', { name: '修改后的标题' })).toBeVisible()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(frame.getByRole('heading', { name: '原始标题' })).toBeVisible()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('button', { name: '保存页面', exact: true }).click()
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  const saved = await requestJson(request, 'GET', `/api/drafts/${draftId}/pages/${pageId}`, token)
  expect(saved.page.body.html).toBe(original.replace('原始标题', '修改后的标题'))
  await clickCanvasContent(page, 'img')
  const uploaded = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/assets'))
  const productImage = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#246ab2' } }).png().toBuffer()
  await page.getByLabel('上传替换').setInputFiles({ name: 'product.png', mimeType: 'image/png', buffer: productImage })
  const uploadResponse = await uploaded
  expect(uploadResponse.ok(), await uploadResponse.text()).toBeTruthy()
  await expect(frame.getByRole('img', { name: '产品图片' })).toHaveAttribute('src', /\/api\/drafts\/.*\/assets\/|\/preview-assets\//)
  await page.getByRole('button', { name: '保存页面', exact: true }).click()
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  const withImage = await requestJson(request, 'GET', `/api/drafts/${draftId}/pages/${pageId}`, token)
  expect(withImage.page.body.html).toContain('/assets/')
  expect(withImage.page.body.html).not.toContain('previewUrl')
  expect(withImage.page.body.html).toContain('<script>window.editorUnknownScriptExecuted=true</script>')
  await page.getByRole('complementary', { name: '内容目录' }).getByRole('button', { name: 'intro', exact: true }).click()
  await page.getByRole('complementary', { name: '内容目录' }).getByRole('button', { name: 'intro', exact: true }).press('Control+d')
  await expect(frame.locator('section')).toHaveCount(2)
  const copiedId = await frame.locator('section').nth(1).getAttribute('id')
  await page.getByRole('complementary', { name: '内容目录' }).getByRole('button', { name: copiedId!, exact: true }).click()
  await page.getByRole('complementary', { name: '内容目录' }).getByRole('button', { name: copiedId!, exact: true }).press('Alt+ArrowUp')
  await expect(frame.locator('section').first()).toHaveAttribute('id', copiedId!)
  await page.getByText('高级 HTML 属性', { exact: true }).click()
  await page.getByLabel('HTML 属性名称').selectOption('title')
  await page.getByLabel('HTML 属性值').fill('区域说明')
  await page.getByRole('button', { name: '应用属性', exact: true }).click()
  await expect(frame.locator('section').first()).toHaveAttribute('title', '区域说明')
  await page.getByLabel('图片用途').selectOption('background')
  await page.getByRole('combobox', { name: '图库', exact: true }).selectOption({ label: 'product.png · 16×12' })
  await expect(frame.locator('section').first()).toHaveCSS('background-image', /preview-assets|\/assets\//)
  await page.getByRole('button', { name: '保存页面', exact: true }).click()
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  await page.reload()
  await expect(frame.locator('section')).toHaveCount(2)
  await page.getByRole('button', { name: '体验模式', exact: true }).click()
  await expect(page.getByTitle('页面体验预览')).toHaveAttribute('sandbox', 'allow-scripts')
  expect(await page.getByTitle('页面体验预览').getAttribute('srcdoc')).toContain("connect-src 'none'")
  await expect(editor).toBeVisible()
})

test('Guide 属性、页面信息保存及当前页面发布', async ({ page, request }) => {
  test.setTimeout(90_000)
  page.on('pageerror', error => console.error(error.stack))
  const suffix = Date.now().toString(36)
  const registered = await requestJson(request, 'POST', '/api/auth/register', '', { account: `guide-${suffix}`, password: 'VisualEditor123!', name: 'Guide 检查' })
  const token = registered.accessToken
  const created = await requestJson(request, 'POST', '/api/drafts', token, { name: `Guide 网站 ${suffix}` })
  const draftId = created.draft.draftId
  const createdPage = await requestJson(request, 'POST', `/api/drafts/${draftId}/pages`, token, { kind: 'ads', title: 'Guide 页面', slug: `guide-${suffix}` })
  const pageId = createdPage.page.pageId
  const ads = { keywordCluster: ['product-alpha', 'product-beta'], screens: [
    { screenId: 'entry-a', role: 'entry', title: '产品甲入口', html: '<section id="guide-area"><h2>产品甲</h2><button data-guide-option="a-detail">查看介绍</button></section>', entryFor: ['product-alpha'] },
    { screenId: 'entry-b', role: 'entry', title: '产品乙入口', html: '<h2>产品乙</h2>', entryFor: ['product-beta'] },
    { screenId: 'detail', role: 'content', title: '产品介绍', html: '<h2>产品介绍</h2>' },
    { screenId: 'cta', role: 'cta', title: '询盘', html: '<form data-olps-inquiry><input name="name"><input name="email"><textarea name="message"></textarea><button type="submit">发送</button></form>' },
  ], guide: { entryByKeyword: { 'product-alpha': 'entry-a', 'product-beta': 'entry-b' }, nodes: { 'entry-a': { options: [{ id: 'a-detail', label: '查看介绍', action: 'navigate', targetScreenId: 'detail' }] }, 'entry-b': { options: [{ id: 'b-cta', label: '联系产品乙', action: 'go_cta' }] }, detail: { options: [{ id: 'detail-cta', label: '联系咨询', action: 'go_cta' }] }, cta: { options: [] } } } }
  await requestJson(request, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}/editor`, token, { body: { html: '<div id="olps-ads-root"></div>', ads }, expectedUpdatedAt: createdPage.page.updatedAt })
  await page.addInitScript(({ token, draftId }) => { if (window !== window.top) return; localStorage.setItem('olps_access_token', token); localStorage.setItem('olps_draft_id', draftId) }, { token, draftId })
  await page.goto(`/drafts/${draftId}/pages/${pageId}`)
  await page.getByRole('region', { name: 'Guide 按钮' }).getByRole('button', { name: '查看介绍', exact: true }).click()
  await page.getByLabel('搜索 Guide 目标').fill('产品介绍')
  await expect(page.getByLabel('Guide 跳转目标').locator('option')).toHaveCount(2)
  await expect(page.getByLabel('Guide 跳转目标').locator('option').last()).toHaveText('产品介绍 · detail')
  await page.getByLabel('搜索 Guide 目标').fill('')
  await page.getByRole('button', { name: '预览 Guide 目标', exact: true }).click()
  await expect(page.frameLocator('iframe[title="页面体验预览"]').locator('[data-screen-id="detail"]')).toBeVisible()
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await page.getByLabel('Guide 按钮文字').fill('直接咨询')
  await page.getByLabel('Guide 按钮文字').blur()
  await expect(page.frameLocator('.gjs-frame').locator('[data-guide-option="a-detail"]')).toHaveText('直接咨询')
  await page.getByLabel('Guide 跳转目标').selectOption('entry-a')
  await expect(page.getByRole('region', { name: 'Guide 检查' })).toContainText('有向环')
  await page.getByLabel('Guide 跳转目标').selectOption('CTA')
  await expect(page.getByRole('region', { name: 'Guide 检查' })).toContainText('检查通过')
  await page.getByRole('complementary', { name: '内容目录' }).getByRole('button', { name: 'guide-area', exact: true }).click()
  await page.getByRole('button', { name: '复制区域', exact: true }).click()
  const canvas = page.frameLocator('.gjs-frame')
  await expect(canvas.locator('[data-guide-option]')).toHaveCount(2)
  const duplicatedOption = await canvas.locator('[data-guide-option]').nth(1).getAttribute('data-guide-option')
  expect(duplicatedOption).not.toBe('a-detail')
  const duplicatedArea = await canvas.locator('section').nth(1).getAttribute('id')
  await page.getByRole('complementary', { name: '内容目录' }).getByRole('button', { name: duplicatedArea!, exact: true }).click()
  await page.getByRole('button', { name: '删除区域', exact: true }).click()
  await page.getByRole('button', { name: '确认删除区域', exact: true }).click()
  await expect(canvas.locator('[data-guide-option]')).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Guide 检查' })).toContainText('检查通过')
  await page.getByRole('button', { name: '体验模式', exact: true }).click()
  const experienceFrame = page.frameLocator('iframe[title="页面体验预览"]')
  await page.getByTitle('页面体验预览').scrollIntoViewIfNeeded()
  await experienceFrame.getByRole('complementary', { name: 'Guide', exact: true }).getByRole('button', { name: '直接咨询', exact: true }).click()
  await expect(experienceFrame.locator('[data-screen-id="cta"] form[data-olps-inquiry]')).toBeVisible()
  await experienceFrame.getByRole('button', { name: '返回上一屏', exact: true }).click()
  await expect(experienceFrame.locator('[data-screen-id="entry-a"]')).toBeVisible()
  await page.getByRole('button', { name: '编辑模式', exact: true }).click()
  await page.getByText('页面信息与 SEO', { exact: true }).click()
  await page.getByLabel('标题', { exact: true }).fill('Guide 页面更新')
  await page.getByRole('button', { name: '保存页面', exact: true }).click()
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  const saved = await requestJson(request, 'GET', `/api/drafts/${draftId}/pages/${pageId}`, token)
  expect(saved.page.title).toBe('Guide 页面更新')
  expect(saved.page.body.ads.screens.find((screen: { screenId: string }) => screen.screenId === 'entry-a').html).toContain('>直接咨询</button>')
  expect(saved.page.body.ads.guide.nodes['entry-a'].options[0]).toEqual({ id: 'a-detail', label: '直接咨询', action: 'go_cta' })
  await page.getByRole('button', { name: '发布此页面', exact: true }).click()
  const inspected = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/publication/preview'))
  await page.getByRole('button', { name: '发布所选页面', exact: true }).click()
  const inspectedResponse = await inspected
  const inspectedBody = await inspectedResponse.json()
  expect(inspectedBody.issues, JSON.stringify(inspectedBody)).toEqual([])
  await expect(page.getByRole('dialog', { name: '确认发布范围' })).toBeVisible()
  const confirmed = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/publication/confirm'))
  await page.getByRole('button', { name: '确认发布', exact: true }).click()
  const confirmedResponse = await confirmed
  expect(confirmedResponse.ok(), await confirmedResponse.text()).toBeTruthy()
  await expect(page.getByRole('status').filter({ hasText: '发布成功' })).toBeVisible({ timeout: 90_000 })
  const publicUrl = await page.getByRole('link', { name: '查看网站', exact: true }).getAttribute('href')
  expect(publicUrl).toBeTruthy()
  const visitor = await page.context().newPage()
  await visitor.goto(publicUrl!.replace(/\/$/, '') + `/guide-${suffix}--product-alpha/`)
  await expect(visitor.getByRole('heading', { name: '产品甲', exact: true })).toBeVisible()
  await visitor.locator('[data-olps-guide-float]').getByRole('button', { name: '直接咨询', exact: true }).click()
  await expect(visitor.locator('form[data-olps-inquiry]')).toBeVisible()
  await visitor.close()
})

test('手机平板桌面独立样式及持久标识保存后保持有效', async ({ page, request }) => {
  const suffix = Date.now().toString(36)
  const registered = await requestJson(request, 'POST', '/api/auth/register', '', { account: `devices-${suffix}`, password: 'VisualEditor123!', name: '设备样式检查' })
  const token = registered.accessToken
  const created = await requestJson(request, 'POST', '/api/drafts', token, { name: `设备样式 ${suffix}` })
  const draftId = created.draft.draftId
  const createdPage = await requestJson(request, 'POST', `/api/drafts/${draftId}/pages`, token, { kind: 'site', title: '设备样式', slug: `devices-${suffix}` })
  const pageId = createdPage.page.pageId
  const originalCss = '<style>@media(max-width:599px){#responsive{padding:11px}}</style>'
  await requestJson(request, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}/editor`, token, { body: { html: originalCss + '<section id="responsive" style="width:420px;color:rgb(12,34,56)"><h2>设备样式内容</h2></section>' }, expectedUpdatedAt: createdPage.page.updatedAt })
  await page.addInitScript(({ token, draftId }) => { if (window !== window.top) return; localStorage.setItem('olps_access_token', token); localStorage.setItem('olps_draft_id', draftId) }, { token, draftId })
  await page.goto(`/drafts/${draftId}/pages/${pageId}`)
  const canvas = page.frameLocator('.gjs-frame')
  await expect(canvas.locator('#responsive')).toBeVisible()
  await page.getByRole('complementary', { name: '内容目录' }).getByRole('button', { name: 'responsive', exact: true }).click()
  await expect(page.getByLabel('样式作用范围')).toHaveValue('all')
  await page.getByLabel('样式作用范围').selectOption('current')
  for (const [device, width] of [['mobile', '280px'], ['tablet', '600px'], ['desktop', '900px']]) {
    await page.getByLabel('设备尺寸').selectOption(device!)
    await page.getByLabel('显示宽度', { exact: true }).fill(width!)
    await page.getByLabel('显示宽度', { exact: true }).press('Tab')
    await expect(canvas.locator('#responsive')).toHaveCSS('width', width!)
  }
  const stableId = await canvas.locator('#responsive').getAttribute('data-olps-style')
  expect(stableId).toBeTruthy()
  await page.getByRole('button', { name: '保存页面', exact: true }).click()
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  const saved = await requestJson(request, 'GET', `/api/drafts/${draftId}/pages/${pageId}`, token)
  expect(saved.page.body.html).toContain(originalCss)
  expect(saved.page.metadata.editor.version).toBe(1)
  expect(saved.page.metadata.editor.elementIds).toContain(stableId)
  await page.reload()
  for (const [device, width] of [['mobile', '280px'], ['tablet', '600px'], ['desktop', '900px']]) {
    await page.getByLabel('设备尺寸').selectOption(device!)
    await expect(canvas.locator('#responsive')).toHaveCSS('width', width!)
    await expect(canvas.locator('#responsive')).toHaveAttribute('data-olps-style', stableId!)
  }
})

test('历史图片与关联 CSS 在授权画布中显示并保持原始引用', async ({ page, request }) => {
  const suffix = Date.now().toString(36)
  const registered = await requestJson(request, 'POST', '/api/auth/register', '', { account: `legacy-${suffix}`, password: 'VisualEditor123!', name: '历史资源检查' })
  const token = registered.accessToken
  const created = await requestJson(request, 'POST', '/api/drafts', token, { name: `历史资源 ${suffix}` })
  const draftId = created.draft.draftId
  const draft = await requestJson(request, 'GET', `/api/drafts/${draftId}`, token)
  const sandboxRoot = process.env.OLPS_E2E_SANDBOX_ROOT || resolve(process.cwd(), '../../.intermediate/visual-editor-e2e/sandboxes')
  const workspace = join(sandboxRoot, draft.draft.sandboxId)
  await mkdir(join(workspace, 'assets/images'), { recursive: true })
  await mkdir(join(workspace, 'assets/css'), { recursive: true })
  const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#315f87' } }).png().toBuffer()
  await writeFile(join(workspace, 'assets/images/old.png'), png)
  await writeFile(join(workspace, 'assets/css/old.css'), '.legacy{color:rgb(42,84,126);background-image:url("../images/old.png")}')
  const createdPage = await requestJson(request, 'POST', `/api/drafts/${draftId}/pages`, token, { kind: 'site', title: '历史资源', slug: `legacy-${suffix}` })
  const pageId = createdPage.page.pageId
  const original = '<link rel="stylesheet" href="/assets/css/old.css"><style>.legacy-embedded{background-image:url("/assets/images/old.png")}</style><picture><source srcset="/assets/images/old.png 1x"><img id="legacy-image" alt="历史图片" src="/assets/images/old.png" srcset="/assets/images/old.png 1x"></picture><section class="legacy">历史样式</section><section class="legacy-embedded">内嵌背景</section>'
  await requestJson(request, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}/editor`, token, { body: { html: original }, expectedUpdatedAt: createdPage.page.updatedAt })
  const uploaded = await requestJson(request, 'GET', `/api/drafts/${draftId}/assets`, token)
  expect(uploaded.assets).toHaveLength(0)
  await page.addInitScript(({ token, draftId }) => { if (window !== window.top) return; localStorage.setItem('olps_access_token', token); localStorage.setItem('olps_draft_id', draftId) }, { token, draftId })
  await page.goto(`/drafts/${draftId}/pages/${pageId}`)
  const canvas = page.frameLocator('.gjs-frame')
  await expect(canvas.getByRole('img', { name: '历史图片' })).toHaveAttribute('src', /\/api\/drafts\/.*token=/)
  await expect.poll(() => canvas.locator('#legacy-image').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(32)
  await expect(canvas.locator('.legacy')).toHaveCSS('color', 'rgb(42, 84, 126)')
  await expect(canvas.locator('.legacy-embedded')).toHaveCSS('background-image', /\/api\/drafts\/.*token=/)
  await expect(canvas.locator('.legacy')).toHaveCSS('background-image', /\/api\/drafts\/.*token=/)
  await page.getByRole('button', { name: '保存页面', exact: true }).click()
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  const saved = await requestJson(request, 'GET', `/api/drafts/${draftId}/pages/${pageId}`, token)
  expect(saved.page.body.html).toBe(original)
})

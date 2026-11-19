import { expect, test, type Page } from '@playwright/test'
import {
  createDraftOnWorkspace,
  createSitePageAndOpen,
  registerAndEnterWorkspace,
  requireApiReady,
  setPageBodyHtml,
} from './helpers'
import { adminAuthedJson } from './inquiry-helpers'

const previewPost = /\/api\/drafts\/[^/]+\/pages\/[^/]+\/preview$/

const inlineSvgDataUrl =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#cc0066"/></svg>',
  )

async function postPreviewExpect200(page: Page): Promise<{ previewUrl: string }> {
  const previewWait = page.waitForResponse(
    (r) => previewPost.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 90_000 },
  )
  await page.getByRole('button', { name: '保存并预览', exact: true }).first().click()
  const previewRes = await previewWait
  const bodyText = await previewRes.text()
  expect(previewRes.status(), bodyText).toBe(200)
  const json = JSON.parse(bodyText) as { previewUrl?: string }
  if (!json.previewUrl) {
    throw new Error(`preview POST 200 但缺少 previewUrl：${bodyText}`)
  }
  expect(json.previewUrl).toMatch(/^\/preview-access\//)
  return { previewUrl: json.previewUrl }
}

async function scrollPreviewIframeIntoView(page: Page): Promise<void> {
  const iframe = page.locator('iframe[title="page-preview"]')
  await expect(iframe).toBeVisible({ timeout: 60_000 })
  await iframe.scrollIntoViewIfNeeded()
}

async function expectInlineStyleColor(
  frame: ReturnType<Page['frameLocator']>,
  selector: string,
  expectedRgb: string,
): Promise<void> {
  const color = await frame.locator(selector).evaluate((el) => getComputedStyle(el).color)
  expect(color, `${selector} computed color`).toBe(expectedRgb)
}

async function expectEmbeddedSvgRendered(frame: ReturnType<Page['frameLocator']>): Promise<void> {
  const imgState = await frame.locator('img.e2e-preview-svg').evaluate((img) => {
    const el = img as HTMLImageElement
    return { complete: el.complete, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight }
  })
  expect(imgState.complete, '内嵌 SVG img.complete').toBe(true)
  expect(imgState.naturalWidth, '内嵌 SVG naturalWidth').toBeGreaterThan(0)
  expect(imgState.naturalHeight, '内嵌 SVG naturalHeight').toBeGreaterThan(0)
}

test('通用站页：保存并预览展示当前正文、内联样式与内嵌 SVG 图片', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const marker = `E2E_PREVIEW_${suffix}`

  await registerAndEnterWorkspace(page, {
    account: `prev-${suffix}`,
    password: 'E2ePass1!',
    name: 'Preview E2E',
  })
  await createDraftOnWorkspace(page, `预览 ${suffix}`)
  await createSitePageAndOpen(page, {
    title: `预览页 ${suffix}`,
    slug: `preview-${suffix}`,
  })
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  await setPageBodyHtml(
    page,
    `<style>.e2e-preview-accent{color:rgb(204,0,102);}</style>
<p class="e2e-preview-marker" style="color:rgb(17,34,51);">${marker}</p>
<p class="e2e-preview-accent">accent</p>
<img class="e2e-preview-svg" alt="e2e-preview-svg" src="${inlineSvgDataUrl}"/>`,
  )
  await expect(page.locator('[data-page-save-status]')).toHaveText('有未保存修改')

  await postPreviewExpect200(page)
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  await scrollPreviewIframeIntoView(page)

  const frame = page.frameLocator('iframe[title="page-preview"]')
  await expect(frame.locator('body')).toContainText(marker, { timeout: 60_000 })
  await expectInlineStyleColor(frame, '.e2e-preview-marker', 'rgb(17, 34, 51)')
  await expectInlineStyleColor(frame, '.e2e-preview-accent', 'rgb(204, 0, 102)')
  await expectEmbeddedSvgRendered(frame)
})

test('已有预览后保存失败时保留编辑内容、清除旧预览并终止预览请求', async ({ page, context }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await registerAndEnterWorkspace(page, {
    account: `prev-fail-${suffix}`, password: 'E2ePass1!', name: 'Preview save failure',
  })
  await createDraftOnWorkspace(page, `预览保存失败 ${suffix}`)
  await createSitePageAndOpen(page, { title: `预览保存失败页 ${suffix}`, slug: `preview-fail-${suffix}` })
  await postPreviewExpect200(page)
  await scrollPreviewIframeIntoView(page)
  const description = page.locator('label:has-text("SEO description") textarea')
  await description.fill(`UNSAVED_${suffix}`)
  let previewRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && previewPost.test(new URL(request.url()).pathname)) previewRequests += 1
  })
  // 断开浏览器网络，使保存请求真实失败
  await context.setOffline(true)
  try {
    await page.getByRole('button', { name: '保存并预览', exact: true }).first().click()
    await expect(page.locator('p.error')).toBeVisible()
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
    await expect(description).toHaveValue(`UNSAVED_${suffix}`)
    await expect(page.locator('[data-page-save-status]')).toHaveText('保存失败，输入已保留，请重试')
    expect(previewRequests).toBe(0)
    await expect(page.locator('iframe[title="page-preview"]')).toHaveCount(0)
  } finally {
    await context.setOffline(false)
  }
  await page.getByRole('button', { name: '重试保存全部修改', exact: true }).click()
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  await expect(description).toHaveValue(`UNSAVED_${suffix}`)
})

test('取消离开和浏览器刷新保留输入，保存后可以离开', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await registerAndEnterWorkspace(page, {
    account: `leave-${suffix}`, password: 'E2ePass1!', name: 'Leave protection',
  })
  await createDraftOnWorkspace(page, `离开保护 ${suffix}`)
  await createSitePageAndOpen(page, { title: `编辑 ${suffix}`, slug: `leave-${suffix}` })
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  const detailUrl = page.url()
  const html = `<p>UNSAVED_${suffix}</p>`
  await setPageBodyHtml(page, html)
  const dialogWait = page.waitForEvent('dialog')
  const leaveClick = page.getByRole('link', { name: '← 返回列表', exact: true }).click()
  const dialog = await dialogWait
  expect(dialog.type()).toBe('confirm')
  await dialog.dismiss()
  await leaveClick
  await expect(page).toHaveURL(detailUrl)
  await expect(page.locator('label:has-text("body.html") textarea')).toHaveValue(html)

  const unloadWait = page.waitForEvent('dialog')
  const reloadResult = page.evaluate(() => window.location.reload())
  const unloadDialog = await unloadWait
  expect(unloadDialog.type()).toBe('beforeunload')
  await unloadDialog.dismiss()
  await reloadResult
  await expect(page).toHaveURL(detailUrl)
  await expect(page.locator('label:has-text("body.html") textarea')).toHaveValue(html)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  await page.getByRole('link', { name: '← 返回列表', exact: true }).click()
  await expect(page).toHaveURL(/\/pages$/)
  await page.reload()
  await expect(page).toHaveURL(/\/pages$/)
})

test('真实请求期间继续输入、重复保存及取消离开保留编辑', async ({ page, context }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await registerAndEnterWorkspace(page, {
    account: `pending-${suffix}`, password: 'E2ePass1!', name: 'Pending edits',
  })
  await createDraftOnWorkspace(page, `请求期间编辑 ${suffix}`)
  const { draftId, pageId } = await createSitePageAndOpen(page, {
    title: `请求期间编辑 ${suffix}`, slug: `pending-${suffix}`,
  })
  const detailPath = `/api/drafts/${draftId}/pages/${pageId}`
  const seo = page.locator('label:has-text("SEO description") textarea')
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  // 为真实 HTTP 连接增加延迟，确保可以在响应返回前继续输入。
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 2000, downloadThroughput: -1, uploadThroughput: -1,
  })
  try {
    await seo.fill(`SUBMITTED_${suffix}`)
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith(detailPath)) {
        requests.push(`${request.method()} ${new URL(request.url()).pathname}`)
      }
    })
    const saved = page.waitForResponse((response) =>
      response.request().method() === 'PATCH' && new URL(response.url()).pathname === detailPath,
    )
    await page.locator('button').evaluateAll((elements) => {
      const buttons = elements.filter((element): element is HTMLButtonElement => element instanceof HTMLButtonElement)
      const save = buttons.find((button) => button.textContent?.trim() === '保存')!
      save.click()
      save.click()
      buttons.find((button) => button.textContent?.trim() === '保存并预览')!.click()
    })
    await expect(page.locator('[data-page-save-status]')).toHaveText('正在保存…')
    await seo.fill(`NEW_INPUT_${suffix}`)
    const dialogWait = page.waitForEvent('dialog')
    const leaveClick = page.getByRole('link', { name: '← 返回列表', exact: true }).click()
    const dialog = await dialogWait
    await dialog.dismiss()
    await leaveClick
    expect((await saved).status()).toBe(200)
    await expect(page.locator('[data-page-save-status]')).toHaveText('有未保存修改')
    await expect(seo).toHaveValue(`NEW_INPUT_${suffix}`)
    expect(requests).toEqual([`PATCH ${detailPath}`])
    const stored = await adminAuthedJson<{ page: { seo: { description: string } } }>(page, 'GET', detailPath)
    expect(stored.page.seo.description).toBe(`SUBMITTED_${suffix}`)

    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
  } finally {
    await cdp.detach()
  }
})

test('路由参数切换时取消保留输入，确认后加载目标页面', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  await registerAndEnterWorkspace(page, {
    account: `route-${suffix}`, password: 'E2ePass1!', name: 'Route protection',
  })
  await createDraftOnWorkspace(page, `参数切换 ${suffix}`)
  await createSitePageAndOpen(page, { title: `目标页面 ${suffix}`, slug: `target-${suffix}` })
  const targetUrl = page.url()
  await page.getByRole('link', { name: '← 返回列表', exact: true }).click()
  await createSitePageAndOpen(page, { title: `当前页面 ${suffix}`, slug: `current-${suffix}` })
  const currentUrl = page.url()
  const html = `<p>ROUTE_INPUT_${suffix}</p>`
  await setPageBodyHtml(page, html)
  const cancelWait = page.waitForEvent('dialog')
  await page.evaluate(() => history.go(-2))
  const cancelDialog = await cancelWait
  expect(cancelDialog.type()).toBe('confirm')
  await cancelDialog.dismiss()
  await expect(page).toHaveURL(currentUrl)
  await expect(page.locator('label:has-text("body.html") textarea')).toHaveValue(html)
  const confirmWait = page.waitForEvent('dialog')
  await page.evaluate(() => history.go(-2))
  const confirmDialog = await confirmWait
  await confirmDialog.accept()
  await expect(page).toHaveURL(targetUrl)
  await expect(page.locator('h1')).toHaveText(`目标页面 ${suffix}`)
  await expect(page.locator('[data-page-save-status]')).toHaveText('已保存')
})

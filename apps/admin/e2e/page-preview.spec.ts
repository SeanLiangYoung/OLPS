import { expect, test, type Page } from '@playwright/test'
import {
  createDraftOnWorkspace,
  createSitePageAndOpen,
  registerAndEnterWorkspace,
  requireApiReady,
  savePageDetail,
  setPageBodyHtml,
} from './helpers'
import { createAdsPageAndOpen } from './inquiry-helpers'

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
  await page.getByRole('button', { name: '写预览' }).click()
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

test('通用站页：写预览后 iframe 展示正文、内联样式与内嵌 SVG 图片', async ({ page }) => {
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
  await setPageBodyHtml(
    page,
    `<style>.e2e-preview-accent{color:rgb(204,0,102);}</style>
<p class="e2e-preview-marker" style="color:rgb(17,34,51);">${marker}</p>
<p class="e2e-preview-accent">accent</p>
<img class="e2e-preview-svg" alt="e2e-preview-svg" src="${inlineSvgDataUrl}"/>`,
  )
  await savePageDetail(page)

  await postPreviewExpect200(page)
  await scrollPreviewIframeIntoView(page)

  const frame = page.frameLocator('iframe[title="page-preview"]')
  await expect(frame.locator('body')).toContainText(marker, { timeout: 60_000 })
  await expectInlineStyleColor(frame, '.e2e-preview-marker', 'rgb(17, 34, 51)')
  await expectInlineStyleColor(frame, '.e2e-preview-accent', 'rgb(204, 0, 102)')
  await expectEmbeddedSvgRendered(frame)
})

test('广告承接页：iframe 预览含运行时数据、Guide 可见且可进入 CTA 屏', async ({ page }) => {
  await requireApiReady()
  const suffix = Date.now().toString(36)
  const keywordA = `kw-a-${suffix}`
  const keywordB = `kw-b-${suffix}`
  const pageTitle = `广告预览 ${suffix}`

  await registerAndEnterWorkspace(page, {
    account: `prev-ads-${suffix}`,
    password: 'E2ePass1!',
    name: 'Preview Ads',
  })
  await createDraftOnWorkspace(page, `广告预览草稿 ${suffix}`)
  await createAdsPageAndOpen(page, {
    title: pageTitle,
    slug: `ads-preview-${suffix}`,
    keywordA,
    keywordB,
  })

  await postPreviewExpect200(page)
  await scrollPreviewIframeIntoView(page)

  const frame = page.frameLocator('iframe[title="page-preview"]')
  await expect(frame.locator('#olps-ads-data')).toHaveCount(1, { timeout: 60_000 })
  const guide = frame.locator('[data-olps-guide-float]')
  await expect(guide).toBeVisible()
  const guideDisplay = await guide.evaluate((el) => getComputedStyle(el).display)
  expect(guideDisplay).not.toBe('none')
  const guideBackground = await guide.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(guideBackground).toBe('rgb(16, 35, 31)')
  await expect(frame.locator('body')).toContainText(keywordA)

  await scrollPreviewIframeIntoView(page)
  await frame.locator('body').evaluate((body) => {
    body.scrollTop = body.scrollHeight
  })
  const goInGuide = guide.getByRole('button', { name: 'Go' })
  await goInGuide.scrollIntoViewIfNeeded()
  await goInGuide.click({ timeout: 15_000 })
  await expect(frame.locator('form[data-olps-inquiry]')).toHaveCount(1, { timeout: 30_000 })
  await expect(frame.getByRole('button', { name: 'Send ads' })).toBeVisible()
})

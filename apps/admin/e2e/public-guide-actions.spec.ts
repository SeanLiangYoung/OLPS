import { test, expect, type APIRequestContext } from '@playwright/test'

const apiBase = process.env.OLPS_API_URL || 'http://127.0.0.1:8787'

async function json(request: APIRequestContext, method: string, path: string, token = '', data?: unknown) {
  const response = await request.fetch(apiBase + path, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, data })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

for (const scenario of ['html-guide', 'link-page', 'second-inquiry']) {
  test(`公开广告操作 ${scenario}`, async ({ request, page }) => {
    const suffix = `${Date.now().toString(36)}-${scenario}`
    const registered = await json(request, 'POST', '/api/auth/register', '', { account: `public-${suffix}`, password: 'PublicGuide123!', name: '公开检查' })
    const token = registered.accessToken
    const created = await json(request, 'POST', '/api/drafts', token, { name: `公开检查 ${suffix}` })
    const draftId = created.draft.draftId
    const target = (await json(request, 'POST', `/api/drafts/${draftId}/pages`, token, { kind: 'ads', title: '目标广告', slug: `target-${suffix}` })).page
    const source = (await json(request, 'POST', `/api/drafts/${draftId}/pages`, token, { kind: 'ads', title: '来源广告', slug: `source-${suffix}` })).page
    const form = '<form data-olps-inquiry><label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Message<textarea name="message" required></textarea></label><button type="submit">发送询盘</button><p data-olps-inquiry-status></p></form>'
    for (const item of [target, source]) {
      const ads = { keywordCluster: ['first-keyword'], screens: [
        { screenId: 'entry', role: 'entry', title: '入口', html: '<h1>公开入口</h1><button data-guide-option="detail">正文介绍</button>', entryFor: ['first-keyword'] },
        { screenId: 'detail', role: 'content', title: '介绍', html: '<h2>公开介绍</h2><a href="#unused" data-olps-guide-option="contact">正文咨询</a>' },
        { screenId: 'cta', role: 'cta', title: '询盘', html: form + form },
      ], guide: { entryByKeyword: { 'first-keyword': 'entry' }, nodes: {
        entry: { options: [{ id: 'detail', label: '悬浮介绍', action: 'navigate', targetScreenId: 'detail' }, { id: 'contact', label: '悬浮咨询', action: 'go_cta' }, ...(item.pageId === source.pageId ? [{ id: 'target', label: '目标页面', action: 'link_page', pageId: target.pageId }] : [])] },
        detail: { options: [{ id: 'contact', label: '悬浮咨询', action: 'go_cta' }] }, cta: { options: [] },
      } } }
      await json(request, 'PATCH', `/api/drafts/${draftId}/pages/${item.pageId}/editor`, token, { body: { html: '<div id="olps-ads-root"></div>', ads }, expectedUpdatedAt: item.updatedAt })
    }
    const preview = await json(request, 'POST', `/api/drafts/${draftId}/publication/preview`, token, { pageIds: [source.pageId, target.pageId], includeSettings: true })
    expect(preview.issues).toEqual([])
    const published = await json(request, 'POST', `/api/drafts/${draftId}/publication/confirm`, token, { token: preview.token })
    const base = published.publicUrl.replace(/\/$/, '')
    page.on('pageerror', error => { throw error })
    await page.goto(`${base}/${source.slug}--first-keyword/`)
    if (scenario === 'html-guide') {
      await page.getByRole('button', { name: '正文介绍', exact: true }).click()
      await expect(page.getByRole('heading', { name: '公开介绍' })).toBeVisible()
      await page.getByRole('link', { name: '正文咨询' }).click()
      await expect(page.locator('form[data-olps-inquiry]')).toHaveCount(2)
    } else if (scenario === 'link-page') {
      await page.getByRole('button', { name: '目标页面' }).click()
      await expect(page).toHaveURL(`${base}/${target.slug}--first-keyword/`)
    } else {
      await page.getByRole('button', { name: '悬浮咨询' }).click()
      const second = page.locator('form[data-olps-inquiry]').nth(1)
      const payload = { name: `Guest ${suffix}`, email: `${suffix}@example.com`, message: `第二个询盘 ${suffix}` }
      await second.getByLabel('Name').fill(payload.name)
      await second.getByLabel('Email').fill(payload.email)
      await second.getByLabel('Message').fill(payload.message)
      const posted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/inquiries?'), { timeout: 15_000 })
      await second.getByRole('button', { name: '发送询盘' }).click()
      expect((await posted).status()).toBe(201)
      await expect(second.locator('[data-olps-inquiry-status]')).toHaveText('Submitted')
      const draft = await json(request, 'GET', `/api/drafts/${draftId}`, token)
      const inquiries = await json(request, 'GET', `/api/sites/${draft.draft.siteId}/inquiries`, token)
      expect(inquiries.inquiries).toContainEqual(expect.objectContaining({ pageId: source.pageId, payload }))
    }
  })
}

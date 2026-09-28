import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AdsPayload } from '@olps/domain'
import { app } from './app.js'
import { generatePageContent } from './generate.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

function adsWithCycle(base: AdsPayload): AdsPayload {
  const ads = structuredClone(base)
  const shared = ads.guide.nodes['shared-proof']
  if (!shared) {
    throw new Error('测试 ads 缺少 shared-proof 节点')
  }
  shared.options.push({
    id: 'cycle-edge',
    label: 'back',
    action: 'navigate',
    targetScreenId: 'entry-0',
  })
  return ads
}

function sampleAdsFromGenerate(): AdsPayload {
  const page = generatePageContent({
    kind: 'ads',
    title: 'Ads Validate',
    slug: 'ads-validate',
    brief: 'brief',
    locale: 'en',
    keywords: ['buy steel', 'rent steel'],
  })
  const ads = page.body.ads
  if (!ads) {
    throw new Error('generatePageContent 未返回 ads')
  }
  return ads
}

describe('Guide 与 ads 保存校验（审查 17）', () => {
  const testPool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await testPool.end()
  })

  async function token(account: string): Promise<string> {
    const reg = await registerUser(app, { account, password: 'guide-pass', name: account })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  async function createAdsDraftPage(ownerToken: string): Promise<{ draftId: string; pageId: string }> {
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: ownerToken,
      body: { name: 'Ads Draft' },
    })
    expect(draft.status).toBe(201)
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: ownerToken,
      body: { kind: 'ads', title: 'Ads', slug: 'ads' },
    })
    expect(page.status).toBe(201)
    const pageId = String((page.body.page as Record<string, unknown>).pageId)
    const valid = sampleAdsFromGenerate()
    const patched = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token: ownerToken,
      body: { body: { html: '<div id="olps-ads-root"></div>', ads: valid } },
    })
    expect(patched.status).toBe(200)
    return { draftId, pageId }
  }

  it('17 PATCH 普通 page 写入含环的 body.ads 返回 400', async () => {
    const ownerToken = await token('patch-ads-invalid')
    const { draftId, pageId } = await createAdsDraftPage(ownerToken)
    const invalid = adsWithCycle(sampleAdsFromGenerate())

    const res = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token: ownerToken,
      body: { body: { html: '<div></div>', ads: invalid } },
    })
    expect(res.status).toBe(400)
  })

  it('17 PATCH guide 写入非法 guide 图返回 400', async () => {
    const ownerToken = await token('patch-guide-invalid')
    const { draftId, pageId } = await createAdsDraftPage(ownerToken)
    const invalid = adsWithCycle(sampleAdsFromGenerate())

    const res = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}/guide`, {
      token: ownerToken,
      body: { guide: invalid.guide },
    })
    expect(res.status).toBe(400)
  })

  it('17 validatePageGuide 使用草稿 settings.screenCap 校验请求内临时 ads', async () => {
    const ownerToken = await token('validate-screen-cap')
    const { draftId, pageId } = await createAdsDraftPage(ownerToken)

    const settings = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/settings`, {
      token: ownerToken,
      body: { screenCap: 2 },
    })
    expect(settings.status).toBe(200)

    const temporaryAds = sampleAdsFromGenerate()
    const validate = await requestJson(
      app,
      'POST',
      `/api/drafts/${draftId}/pages/${pageId}/guide/validate`,
      {
        token: ownerToken,
        body: { ads: temporaryAds },
      },
    )
    expect(validate.status).toBe(200)
    expect((validate.body as { ok?: boolean }).ok).toBe(false)
    const issues = (validate.body as { issues?: Array<{ code: string }> }).issues ?? []
    expect(issues.some((i) => i.code === 'screen_cap_exceeded')).toBe(true)
  })

  it('17 validatePageGuide 临时 ads 非法时返回校验失败且不必先保存页面', async () => {
    const ownerToken = await token('validate-temp-ads')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: ownerToken,
      body: { name: 'Temp Ads' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: ownerToken,
      body: { kind: 'ads', title: 'Ads', slug: 'ads-temp' },
    })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)

    const invalid = adsWithCycle(sampleAdsFromGenerate())
    const validate = await requestJson(
      app,
      'POST',
      `/api/drafts/${draftId}/pages/${pageId}/guide/validate`,
      {
        token: ownerToken,
        body: { ads: invalid },
      },
    )
    expect(validate.status).toBe(200)
    expect((validate.body as { ok?: boolean }).ok).toBe(false)
    const issues = (validate.body as { issues?: Array<{ code: string }> }).issues ?? []
    expect(issues.some((i) => i.code === 'cycle')).toBe(true)
  })
})

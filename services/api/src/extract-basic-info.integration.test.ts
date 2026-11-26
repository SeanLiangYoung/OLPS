import { randomUUID } from 'node:crypto'
import { afterAll, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

const database = createTestPool()
afterAll(async () => {
  await database.end()
})

async function waitSiteReady(siteId: string, token: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await requestJson(app, 'GET', `/api/sites/${siteId}/initialization`, { token })
        if (result.body.initStatus === 'failed') throw new Error(String(result.body.error))
        return result.body.initStatus
      },
      { timeout: 30_000 },
    )
    .toBe('ready')
}

it('应用基本信息写入草稿 settings 与插件设置', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, {
    account: `extract-basic-${randomUUID().slice(0, 8)}`,
    password: 'ExtractBasic123!',
    name: '提取基本信息',
  })
  const created = await requestJson(app, 'POST', '/api/sites', {
    token: owner.accessToken,
    body: { name: '基本信息站' },
  })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  const draftId = String((created.body.draft as Record<string, unknown>).draftId)
  await waitSiteReady(siteId, owner.accessToken)

  const settingsRes = await requestJson(app, 'GET', `/api/drafts/${draftId}/settings`, {
    token: owner.accessToken,
  })
  expect(settingsRes.status).toBe(200)
  const pluginsRes = await requestJson(app, 'GET', `/api/drafts/${draftId}/plugins`, {
    token: owner.accessToken,
  })
  expect(pluginsRes.status).toBe(200)

  const settingsRevision = String(settingsRes.body.revision)
  const pluginsRevision = String(pluginsRes.body.revision)
  const after = {
    siteName: 'Acme Extracted',
    siteUrl: 'https://acme.example',
    company: {
      name: 'Acme Manufacturing',
      address: '100 Industry Road',
      phone: '+1-555-0100',
      email: 'sales@acme.example',
    },
    socialLinks: [{ platform: 'LinkedIn', url: 'https://linkedin.com/company/acme' }],
    iconMediaId: null,
    whatsappPhone: '+1-555-0100',
    mapsAddress: '100 Industry Road',
    qrMedia: [],
  }

  const applyRes = await requestJson(app, 'POST', `/api/drafts/${draftId}/apply-basic-info`, {
    token: owner.accessToken,
    body: {
      locale: 'en',
      after,
      revisions: { settings: settingsRevision, plugins: pluginsRevision },
    },
  })
  expect(applyRes.status, JSON.stringify(applyRes.body)).toBe(200)

  const settingsAfter = await requestJson(app, 'GET', `/api/drafts/${draftId}/settings`, {
    token: owner.accessToken,
  })
  expect(settingsAfter.status).toBe(200)
  const settings = settingsAfter.body.settings as Record<string, unknown>
  expect(settings.siteName).toBe('Acme Extracted')
  expect(settings.siteUrl).toBe('https://acme.example')
  expect(settings.company).toEqual(after.company)
  expect(settings.socialLinks).toEqual(after.socialLinks)

  const whatsapp = await requestJson(app, 'GET', `/api/drafts/${draftId}/plugins/whatsapp/settings`, {
    token: owner.accessToken,
  })
  expect(whatsapp.status).toBe(200)
  expect((whatsapp.body.settings as Record<string, unknown>).phone).toBe('+1-555-0100')

  const maps = await requestJson(app, 'GET', `/api/drafts/${draftId}/plugins/google-maps/settings`, {
    token: owner.accessToken,
  })
  expect(maps.status).toBe(200)
  const mapsSettings = maps.body.settings as Record<string, unknown>
  expect(mapsSettings.defaultAddress === '100 Industry Road' || (mapsSettings.defaultAddress as Record<string, string>).en === '100 Industry Road').toBe(true)

  const conflict = await requestJson(app, 'POST', `/api/drafts/${draftId}/apply-basic-info`, {
    token: owner.accessToken,
    body: {
      locale: 'en',
      after: { ...after, siteName: 'Stale' },
      revisions: { settings: settingsRevision, plugins: pluginsRevision },
    },
  })
  expect(conflict.status).toBe(409)
  expect(conflict.body.code).toBe('REVISION_CONFLICT')
}, 60_000)

it('缺少 AI_API_KEY 时提取接口返回明确错误', async () => {
  await resetTestDatabase()
  const owner = await registerUser(app, {
    account: `extract-no-ai-${randomUUID().slice(0, 8)}`,
    password: 'ExtractBasic123!',
    name: '无密钥',
  })
  const created = await requestJson(app, 'POST', '/api/sites', {
    token: owner.accessToken,
    body: { name: '无密钥站' },
  })
  expect(created.status).toBe(201)
  const siteId = String((created.body.site as Record<string, unknown>).siteId)
  const draftId = String((created.body.draft as Record<string, unknown>).draftId)
  await waitSiteReady(siteId, owner.accessToken)

  const prior = process.env.AI_API_KEY
  delete process.env.AI_API_KEY
  try {
    const extractRes = await requestJson(app, 'POST', `/api/drafts/${draftId}/extract-basic-info`, {
      token: owner.accessToken,
      body: { locale: 'en' },
    })
    expect(extractRes.status).toBe(503)
    expect(String(extractRes.body.error)).toContain('AI_API_KEY')
  } finally {
    if (prior !== undefined) process.env.AI_API_KEY = prior
  }
}, 60_000)

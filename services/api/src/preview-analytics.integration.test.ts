import { afterAll, beforeEach, expect, it } from 'vitest'
import { app } from './app.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requestHtml } from './test-support/request-html.js'

const pool = createTestPool()
beforeEach(resetTestDatabase)
afterAll(() => pool.end())

it('草稿预览保留页面内容并关闭访客行为采集，草稿配置继续保留', async () => {
  const user = await registerUser(app, { account: 'preview-analytics', password: 'preview-password', name: 'Owner' })
  const call = (method: string, url: string, body?: unknown) => requestJson(app, method, url, { token: user.accessToken, body })
  const draft = await call('POST', '/api/drafts', { name: 'Preview analytics' })
  const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
  expect((await call('PATCH', `/api/drafts/${draftId}/settings`, { analyticsEnabled: true })).status).toBe(200)
  const created = await call('POST', `/api/drafts/${draftId}/pages`, { kind: 'content', title: 'Preview content', slug: 'preview-content' })
  const pageId = String((created.body.page as Record<string, unknown>).pageId)
  const preview = await call('POST', `/api/drafts/${draftId}/pages/${pageId}/preview`)
  expect(preview.status).toBe(200)
  const html = await requestHtml(app, 'GET', String(preview.body.previewUrl))
  expect(html.status).toBe(200)
  expect(html.text).toContain('Preview content')
  expect(html.text).not.toContain('olps-visitor-runtime')
  const settings = await call('GET', `/api/drafts/${draftId}`)
  expect(settings.body).toMatchObject({ draft: { settings: { analyticsEnabled: true } } })
})

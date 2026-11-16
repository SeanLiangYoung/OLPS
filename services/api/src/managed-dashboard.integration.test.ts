import { afterAll, beforeEach, expect, it } from 'vitest'
import { app } from './app.js'
import { pool } from './db.js'
import { resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

beforeEach(resetTestDatabase)
afterAll(() => pool.end())

it('网站概况只统计真实线上快照和有权限的历史数据', async () => {
  const user = await registerUser(app, { account: 'managed-dashboard', password: 'dashboard-password', name: '网站用户' })
  const draft = await requestJson(app, 'POST', '/api/drafts', { token: user.accessToken, body: { name: '网站' } })
  const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
  await pool.query(`INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES ('dashboard-site','网站','{}',NOW(),NOW())`)
  await pool.query(`UPDATE site_drafts SET site_id='dashboard-site' WHERE draft_id=$1`, [draftId])
  await pool.query(`INSERT INTO site_owners(site_id,user_id,created_at) VALUES ('dashboard-site',$1,NOW())`, [user.user.userId])
  await pool.query(`INSERT INTO inquiries(draft_id,site_id,payload) VALUES ($1,NULL,'{"name":"历史联系人"}'),(NULL,'dashboard-site','{"name":"线上联系人"}')`, [draftId])
  await pool.query(`INSERT INTO analytics_events(site_id,name,payload,created_at) VALUES ('dashboard-site','page_view','{}',NOW()),('dashboard-site','click','{}',NOW()),('dashboard-site','page_view','{}',NOW()-INTERVAL '40 days')`)
  const result = await requestJson(app, 'GET', `/api/drafts/${draftId}/dashboard`, { token: user.accessToken })
  expect(result.status).toBe(200)
  expect(result.body).toMatchObject({ inquiryCount: 2, eventCount: 2, publishedCount: 0, siteStatsAvailable: true })
  const inquiries = await requestJson(app, 'GET', `/api/drafts/${draftId}/inquiries`, { token: user.accessToken })
  expect(inquiries.body.inquiries).toHaveLength(2)
  await pool.query(`DELETE FROM site_owners WHERE site_id='dashboard-site'`)
  const restricted = await requestJson(app, 'GET', `/api/drafts/${draftId}/dashboard`, { token: user.accessToken })
  expect(restricted.status).toBe(200)
  expect(restricted.body).toMatchObject({ inquiryCount: 1, eventCount: null, publishedCount: 0, siteStatsAvailable: false })
  expect((await requestJson(app, 'GET', `/api/drafts/${draftId}/inquiries`, { token: user.accessToken })).body.inquiries).toHaveLength(1)
})

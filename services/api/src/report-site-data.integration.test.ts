import { afterAll, beforeEach, expect, it } from 'vitest'
import { app } from './app.js'
import { pool } from './db.js'
import { resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

beforeEach(resetTestDatabase)
afterAll(() => pool.end())

async function setup() {
  const user = await registerUser(app, { account: 'report-data-owner', password: 'report-data-password', name: 'Owner' })
  const draft = await requestJson(app, 'POST', '/api/drafts', { token: user.accessToken, body: { name: 'Report data' } })
  const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
  const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, { token: user.accessToken, body: { kind: 'content', title: 'Product', slug: 'product' } })
  const pageId = String((page.body.page as Record<string, unknown>).pageId)
  return { user, draftId, pageId, path: `/api/drafts/${draftId}/pages/${pageId}/report-data` }
}

it('未发布页面明确显示没有线上统计，读取需要真实会话', async () => {
  const { user, path, draftId, pageId } = await setup()
  expect((await app.request(path)).status).toBe(401)
  const response = await app.request(path, { headers: { authorization: `Bearer ${user.accessToken}` } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ data: { status: 'unpublished', draftId, pageId, siteId: null, eventCount: null, inquiryCount: null, events: [] } })
})

it('统计限定所选网站、页面及最近28天，并排除联系人信息', async () => {
  const { user, path, draftId, pageId } = await setup()
  await pool.query(`INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES ('report-site','Site','{"analyticsEnabled":true}',NOW(),NOW()),('other-site','Other','{}',NOW(),NOW())`)
  await pool.query(`UPDATE site_drafts SET site_id='report-site' WHERE draft_id=$1`, [draftId])
  await pool.query(`INSERT INTO site_owners(site_id,user_id,created_at) VALUES ('report-site',$1,NOW())`, [user.user.userId])
  await pool.query(`INSERT INTO analytics_events(site_id,page_id,name,payload,created_at) VALUES
    ('report-site',$1,'page_view','{"email":"private@example.com"}',NOW()),
    ('report-site',$1,'page_view','{}',NOW()),('report-site',$1,'click','{}',NOW()),
    ('report-site',$1,'page_view','{}',NOW()-INTERVAL '40 days'),
    ('report-site','other-page','page_view','{}',NOW()),('other-site',$1,'page_view','{}',NOW())`, [pageId])
  await pool.query(`INSERT INTO inquiries(site_id,page_id,payload,created_at) VALUES
    ('report-site',$1,'{"email":"contact@example.com","message":"Private message"}',NOW()),
    ('report-site',$1,'{}',NOW()-INTERVAL '40 days'),('other-site',$1,'{}',NOW()),('report-site','other-page','{}',NOW())`, [pageId])
  const response = await app.request(path, { headers: { authorization: `Bearer ${user.accessToken}` } })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.data).toMatchObject({ status: 'available', siteId: 'report-site', pageId, analyticsEnabled: true, eventCount: 3, inquiryCount: 1, events: [{ name: 'page_view', count: 2 }, { name: 'click', count: 1 }] })
  expect(Date.parse(body.data.period.end) - Date.parse(body.data.period.start)).toBe(28 * 24 * 60 * 60 * 1000)
  expect(JSON.stringify(body)).not.toMatch(/private@example|contact@example|Private message/)
  const report = await requestJson(app, 'POST', '/api/reports', { token: user.accessToken, body: { draftId, pageId, siteId: 'report-site' } })
  expect(report.status).toBe(201)
  expect((report.body.report as Record<string, unknown>).siteData).toMatchObject({ eventCount: 3, inquiryCount: 1 })
  const reportId = String((report.body.report as Record<string, unknown>).reportId)
  await pool.query(`DELETE FROM analytics_events WHERE site_id='report-site'`)
  const history = await requestJson(app, 'GET', `/api/reports/${reportId}`, { token: user.accessToken })
  expect((history.body.report as Record<string, unknown>).siteData).toMatchObject({ eventCount: 3, inquiryCount: 1 })
})

it('草稿所有者缺少关联网站权限时不能读取统计，其他页面不能混入', async () => {
  const { user, path, draftId } = await setup()
  await pool.query(`INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES ('restricted-site','Restricted','{}',NOW(),NOW())`)
  await pool.query(`UPDATE site_drafts SET site_id='restricted-site' WHERE draft_id=$1`, [draftId])
  const response = await app.request(path, { headers: { authorization: `Bearer ${user.accessToken}` } })
  expect(response.status).toBe(403)
  const other = await registerUser(app, { account: 'report-data-other', password: 'report-data-password', name: 'Other' })
  expect((await app.request(path, { headers: { authorization: `Bearer ${other.accessToken}` } })).status).toBe(403)
})

it('撤销网站权限后，草稿报告列表不会返回网站统计及模型报告内容', async () => {
  const { user, draftId, pageId, path } = await setup()
  await pool.query(`INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES ('history-site','History','{}',NOW(),NOW())`)
  await pool.query(`UPDATE site_drafts SET site_id='history-site' WHERE draft_id=$1`, [draftId])
  await pool.query(`INSERT INTO site_owners(site_id,user_id,created_at) VALUES ('history-site',$1,NOW())`, [user.user.userId])
  const created = await requestJson(app, 'POST', '/api/reports', { token: user.accessToken, body: { draftId, pageId } })
  expect(created.status).toBe(201)
  const reportId = String((created.body.report as Record<string, unknown>).reportId)
  await pool.query(`UPDATE reports SET details='{"summary":"网站诊断内容"}'::jsonb WHERE report_id=$1`, [reportId])
  await pool.query(`DELETE FROM site_owners WHERE site_id='history-site' AND user_id=$1`, [user.user.userId])
  expect((await app.request(path, { headers: { authorization: `Bearer ${user.accessToken}` } })).status).toBe(403)
  const history = await requestJson(app, 'GET', `/api/drafts/${draftId}/reports`, { token: user.accessToken })
  expect(history.status).toBe(200)
  expect(history.body.reports).toEqual([])
  const detail = await requestJson(app, 'GET', `/api/reports/${reportId}`, { token: user.accessToken })
  expect(detail.status).toBe(403)
})

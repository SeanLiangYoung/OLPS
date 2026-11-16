import { afterAll, beforeEach, expect, it } from 'vitest'
import { pool } from './db.js'
import { resetTestDatabase } from './test-support/reset-test-db.js'
import { validateReportUrl, createModelReport, REPORT_SCHEMA_STATEMENTS } from './model-report-service.js'
import { Hono } from 'hono'
import { requireAuth, type AuthVariables } from './auth-middleware.js'
import { mountModelReportRoutes } from './model-report-routes.js'
import { createAccessToken, createSession } from './sessions.js'
import { requestJson } from './test-support/http.js'

beforeEach(async () => {
  await resetTestDatabase()
  for (const statement of REPORT_SCHEMA_STATEMENTS) await pool.query(statement)
})
afterAll(async () => { await pool.end() })

it('拒绝私网、回环、保留地址及非 HTTP URL', async () => {
  for (const url of ['http://127.0.0.1/', 'http://[::1]/', 'http://10.1.2.3/', 'http://169.254.169.254/', 'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd', 'http://user:password@example.com/', 'http://0.0.0.0/', 'http://192.0.2.1/']) {
    await expect(validateReportUrl(url)).rejects.toThrow()
  }
})

it('接受公开 IP，真实 DNS 解析拒绝 localhost', async () => {
  const target = await validateReportUrl('https://1.1.1.1/')
  expect(target.url.hostname).toBe('1.1.1.1')
  expect(target.address.address).toBe('1.1.1.1')
  await expect(validateReportUrl('http://localhost/')).rejects.toThrow('公开诊断禁止访问私网或保留地址')
})

it('模型凭据缺失时保留历史报告', async () => {
  await pool.query(`INSERT INTO users(user_id,account,password_hash,name,created_at,updated_at) VALUES ('report-owner','report-owner','unused','报告用户',NOW(),NOW())`)
  await pool.query(`INSERT INTO site_drafts(draft_id,name,sandbox_id,status,created_at,updated_at) VALUES ('report-draft','报告草稿','report-sandbox','ready',NOW(),NOW())`)
  await pool.query(`INSERT INTO draft_owners(draft_id,user_id,created_at) VALUES ('report-draft','report-owner',NOW())`)
  await pool.query(`INSERT INTO pages(draft_id,page_id,kind,slug,title,status,locale,seo,body,created_at,updated_at)
    VALUES ('report-draft','report-page','content','report-page','报告页面','draft','zh-CN','{}','{"html":"<h1>报告页面</h1>"}',NOW(),NOW())`)
  await pool.query(`INSERT INTO reports(report_id,user_id,draft_id,page_id,score,checklist,created_at)
    VALUES ('existing-report','report-owner','report-draft','report-page',80,'[]',NOW())`)
  const previous = process.env.MINIMAX_API_KEY
  delete process.env.MINIMAX_API_KEY
  try {
    await expect(createModelReport({ userId: 'report-owner', draftId: 'report-draft', pageId: 'report-page' })).rejects.toThrow('MINIMAX_API_KEY')
  } finally { if (previous !== undefined) process.env.MINIMAX_API_KEY = previous }
  expect((await pool.query(`SELECT report_id,score FROM reports`)).rows).toEqual([{ report_id: 'existing-report', score: 80 }])
})

it('未授权诊断不建立报告', async () => {
  await expect(createModelReport({ userId: 'unknown', draftId: 'unknown', pageId: 'unknown' })).rejects.toThrow('FORBIDDEN')
  expect((await pool.query(`SELECT COUNT(*) AS count FROM reports`)).rows[0]?.count).toBe('0')
})

it('真实会话通过诊断 API 验证身份、参数及草稿权限', async () => {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', requireAuth)
  mountModelReportRoutes(app)
  const path = '/api/reports/diagnose'
  expect((await requestJson(app, 'POST', path, { body: {} })).status).toBe(401)
  await pool.query(`INSERT INTO users(user_id,account,password_hash,name,created_at,updated_at) VALUES ('api-report-user','api-report-user','unused','报告用户',NOW(),NOW())`)
  const token = createAccessToken()
  await createSession('api-report-user', token)
  expect((await requestJson(app, 'POST', path, { token, body: {} })).status).toBe(400)
  expect((await requestJson(app, 'POST', path, { token, body: { draftId: 'other', pageId: 'other' } })).status).toBe(403)
})

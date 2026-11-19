import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app.js'
import { appConfig } from './config.js'
import { PUBLISH_CONFIG_PATH } from './workspace-bootstrap.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import {
  extractCanonicalHref,
  extractImageSrcs,
  extractStylesheetHrefs,
  resolvePreviewPath,
} from './test-support/html-resource-urls.js'
import { registerUser, requestJson } from './test-support/http.js'
import { requestHtml } from './test-support/request-html.js'
import { pool } from './db.js'

function hashAccessToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

describe('预览实现审查 RED', () => {
  const testPool = createTestPool()

  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await testPool.end()
  })

  async function authToken(account: string): Promise<string> {
    const reg = await registerUser(app, { account, password: 'preview-review', name: account })
    expect(reg.status).toBe(201)
    return reg.accessToken
  }

  async function issuePreview(
    token: string,
    draftId: string,
    pageId: string,
  ): Promise<{ previewUrl: string; status: number }> {
    const preview = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages/${pageId}/preview`, {
      token,
    })
    const previewUrl = String((preview.body as Record<string, unknown>).previewUrl ?? '')
    return { previewUrl, status: preview.status }
  }

  it('1 session.expires_at 已过期时 GET preview 须拒绝（capability 行仍可未过期）', async () => {
    const ownerToken = await authToken('preview-session-expired')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: ownerToken,
      body: { name: 'Session Expire Draft' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: ownerToken,
      body: { kind: 'content', title: 'P', slug: 'sess-exp' },
    })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)

    const { previewUrl, status } = await issuePreview(ownerToken, draftId, pageId)
    expect(status).toBe(200)
    expect(previewUrl).toMatch(/^\/preview-access\//)

    const sessionRow = await pool.query(`SELECT session_id FROM sessions WHERE token_hash=$1`, [
      hashAccessToken(ownerToken),
    ])
    expect(sessionRow.rowCount).toBe(1)
    const sessionId = String(sessionRow.rows[0]!.session_id)

    const capRow = await pool.query(
      `SELECT expires_at FROM draft_preview_capabilities WHERE session_id=$1`,
      [sessionId],
    )
    expect(capRow.rowCount).toBe(1)
    expect(new Date(String(capRow.rows[0]!.expires_at)).getTime()).toBeGreaterThan(Date.now())

    const past = new Date(Date.now() - 60_000).toISOString()
    await pool.query(`UPDATE sessions SET expires_at=$1 WHERE session_id=$2`, [past, sessionId])

    const res = await requestHtml(app, 'GET', previewUrl)
    expect([401, 403]).toContain(res.status)
  })

  it('2 正式 HTML 内 stylesheet/img URL 经 parse5 解析后 HTTP 可读', async () => {
    const ownerToken = await authToken('preview-html-assets')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: ownerToken,
      body: { name: 'Html Asset Draft' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: ownerToken,
      body: { kind: 'content', title: 'Assets', slug: 'assetpage' },
    })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)

    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ])
    const cssText = '.olps-preview-extra-marker { color: red; }'
    const sandboxRoot = path.join(appConfig.sandboxRoot, draftId)
    await fs.mkdir(path.join(sandboxRoot, 'assets', 'css'), { recursive: true })
    await fs.mkdir(path.join(sandboxRoot, 'assets', 'img'), { recursive: true })
    await fs.writeFile(path.join(sandboxRoot, 'assets', 'css', 'preview-extra.css'), cssText, 'utf8')
    await fs.writeFile(path.join(sandboxRoot, 'assets', 'img', 'marker.png'), pngBytes)

    const html =
      '<h1>Asset page</h1><link rel="stylesheet" href="/assets/css/preview-extra.css"/><img src="/assets/img/marker.png" alt="m"/>'
    const patch = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token: ownerToken,
      body: {
        seo: { title: 'Asset SEO', description: 'Asset desc' },
        body: { html },
      },
    })
    expect(patch.status).toBe(200)

    const { previewUrl, status } = await issuePreview(ownerToken, draftId, pageId)
    expect(status).toBe(200)

    const pageRes = await requestHtml(app, 'GET', previewUrl)
    expect(pageRes.status).toBe(200)

    const stylesheetHrefs = extractStylesheetHrefs(pageRes.text)
    expect(stylesheetHrefs.length).toBeGreaterThan(0)
    for (const href of stylesheetHrefs) {
      const cssPath = resolvePreviewPath(previewUrl, href)
      const cssRes = await requestHtml(app, 'GET', cssPath)
      expect(cssRes.status).toBe(200)
      expect(cssRes.contentType ?? '').toMatch(/text\/css/i)
      expect(cssRes.text).toContain('olps-preview-extra-marker')
    }

    const imageSrcs = extractImageSrcs(pageRes.text)
    expect(imageSrcs.length).toBeGreaterThan(0)
    for (const src of imageSrcs) {
      const imgPath = resolvePreviewPath(previewUrl, src)
      const imgRes = await app.request(imgPath)
      expect(imgRes.status).toBe(200)
      const body = Buffer.from(await imgRes.arrayBuffer())
      expect(body.equals(pngBytes)).toBe(true)
    }
  })

  it('2b 无显式 seo.canonical 的 content 页：parse5 读出 canonical 仅含一处 capability 且指向当前预览页', async () => {
    const ownerToken = await authToken('preview-canonical-auto')
    const slug = 'canonpage'
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: ownerToken,
      body: { name: 'Canonical Draft' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: ownerToken,
      body: { kind: 'content', title: 'Canon', slug },
    })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)

    const patch = await requestJson(app, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}`, {
      token: ownerToken,
      body: {
        seo: { title: 'Canon Title', description: 'Canon description' },
        body: { html: '<h1>Canon body</h1>' },
      },
    })
    expect(patch.status).toBe(200)

    const { previewUrl, status } = await issuePreview(ownerToken, draftId, pageId)
    expect(status).toBe(200)
    expect(previewUrl).toBe(`/preview-access/${previewUrl.match(/^\/preview-access\/([^/]+)\//)![1]}/${slug}/`)

    const pageRes = await requestHtml(app, 'GET', previewUrl)
    expect(pageRes.status).toBe(200)

    const previewToken = previewUrl.match(/^\/preview-access\/([^/]+)\//)![1]!
    const canonical = extractCanonicalHref(pageRes.text)
    expect(canonical).toBeTruthy()

    const capabilityPrefix = `/preview-access/${previewToken}`
    const prefixCount = canonical!.split(capabilityPrefix).length - 1
    expect(prefixCount).toBe(1)
    expect(canonical).not.toMatch(/\/preview-access\/[^/]+\/preview-access\//)

    const canonicalPath = new URL(canonical!, appConfig.publicApiBaseUrl).pathname
    const expectedPreviewPath = `/preview-access/${previewToken}/${slug}/`
    expect(canonicalPath).toBe(expectedPreviewPath)

    const canonicalFetch = await requestHtml(app, 'GET', canonicalPath)
    expect(canonicalFetch.status).toBe(200)
    expect(canonicalFetch.text).toContain('Canon body')
  })

  it('4 缺失或损坏 publish-config 时 preview 须明确失败且不留下可用 capability', async () => {
    const ownerToken = await authToken('preview-bad-publish-config')
    const draft = await requestJson(app, 'POST', '/api/drafts', {
      token: ownerToken,
      body: { name: 'Bad Publish Config' },
    })
    const draftId = String((draft.body.draft as Record<string, unknown>).draftId)
    const page = await requestJson(app, 'POST', `/api/drafts/${draftId}/pages`, {
      token: ownerToken,
      body: { kind: 'content', title: 'X', slug: 'badcfg' },
    })
    const pageId = String((page.body.page as Record<string, unknown>).pageId)

    const configPath = path.join(appConfig.sandboxRoot, draftId, PUBLISH_CONFIG_PATH)

    await fs.rm(configPath, { force: true })
    const missing = await issuePreview(ownerToken, draftId, pageId)
    expect(missing.status).toBeGreaterThanOrEqual(400)
    const capsAfterMissing = await pool.query(
      `SELECT COUNT(*)::int AS c FROM draft_preview_capabilities WHERE draft_id=$1`,
      [draftId],
    )
    expect(Number(capsAfterMissing.rows[0]!.c)).toBe(0)

    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, '{ not-json', 'utf8')
    const broken = await issuePreview(ownerToken, draftId, pageId)
    expect(broken.status).toBeGreaterThanOrEqual(400)
    const capsAfterBroken = await pool.query(
      `SELECT COUNT(*)::int AS c FROM draft_preview_capabilities WHERE draft_id=$1`,
      [draftId],
    )
    expect(Number(capsAfterBroken.rows[0]!.c)).toBe(0)
  })
})

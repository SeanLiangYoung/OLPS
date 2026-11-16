import { afterAll, beforeEach, expect, it } from 'vitest'
import sharp from 'sharp'
import { app } from './app.js'
import { pool } from './db.js'
import { openEditorWorkspace } from './editor-assets.js'
import { resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

beforeEach(resetTestDatabase)
afterAll(() => pool.end())

it('已有草稿图片与CSS依赖使用会话限定资源地址，不能读取源码', async () => {
  const user = await registerUser(app, { account: 'existing-editor-resources', password: 'resource-password', name: '资源用户' })
  const created = await requestJson(app, 'POST', '/api/drafts', { token: user.accessToken, body: { name: '已有资源网站' } })
  const draftId = String((created.body.draft as Record<string, unknown>).draftId)
  const { workspace } = await openEditorWorkspace(String(user.user.userId), draftId)
  await workspace.writeFile('assets/images/old.png', await sharp({ create: { width: 5, height: 4, channels: 3, background: '#abcdef' } }).png().toBuffer())
  await workspace.writeFile('assets/css/site.css', Buffer.from('.hero { background: url("../images/old.png"); }'))
  const result = await requestJson(app, 'GET', `/api/drafts/${draftId}/editor-resources`, { token: user.accessToken })
  expect(result.status).toBe(200)
  const resources = result.body.resources as Array<{ url: string; previewUrl: string }>
  const image = resources.find(resource => resource.url === '/assets/images/old.png')!
  expect(image).toBeTruthy()
  const preview = await app.request(image.previewUrl)
  expect(preview.status).toBe(200)
  expect((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).width).toBe(5)
  const stylesheet = await app.request(resources.find(resource => resource.url === '/assets/css/site.css')!.previewUrl)
  const css = await stylesheet.text()
  expect(css).toContain('editor-resources/assets/images/old.png?token=')
  const nestedUrl = css.match(/url\((?:")?([^)"]+)/)![1]!
  expect((await app.request(nestedUrl)).status).toBe(200)
  const forbidden = image.previewUrl.replace('assets/images/old.png', 'source/site-settings.json')
  expect((await app.request(forbidden)).status).toBe(403)
  await pool.query('DELETE FROM sessions')
  expect((await app.request(image.previewUrl)).status).toBe(403)
})

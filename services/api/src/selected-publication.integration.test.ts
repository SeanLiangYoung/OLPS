import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import sharp from 'sharp'
import { app } from './app.js'
import { selectedPublicationRoutes } from './selected-publication-routes.js'
import { createTestPool, resetTestDatabase } from './test-support/reset-test-db.js'
import { registerUser, requestJson } from './test-support/http.js'

const api = new Hono().route('/', selectedPublicationRoutes).route('/', app)
api.notFound((c) => c.json({ error: '接口不存在' }, 404))
describe('选择页面发布', () => {
  const pool = createTestPool()
  beforeEach(async () => { await resetTestDatabase() })
  afterAll(async () => { await pool.end() })

  async function prepare() {
    const user = await registerUser(api, { account: 'selected-owner', password: 'selected-password', name: '发布用户' })
    const created = await requestJson(api, 'POST', '/api/drafts', { token: user.accessToken, body: { name: '选择发布网站' } })
    expect(created.status).toBe(201)
    const draftId = String((created.body.draft as Record<string, unknown>).draftId)
    const pages = []
    for (const slug of ['selected-a', 'selected-b']) {
      const response = await requestJson(api, 'POST', `/api/drafts/${draftId}/pages`, { token: user.accessToken, body: { kind: 'content', title: slug, slug } })
      expect(response.status).toBe(201)
      pages.push(response.body.page as Record<string, unknown>)
    }
    return { token: user.accessToken, draftId, pages }
  }
  async function publish(token: string, draftId: string, pageIds: unknown[], includeSettings: boolean) {
    const preview = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds, includeSettings } })
    expect(preview.status, JSON.stringify(preview.body)).toBe(200)
    expect(preview.body.issues, JSON.stringify(preview.body)).toEqual([])
    const result = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/confirm`, { token, body: { token: preview.body.token } })
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    return result.body
  }

  it('恢复待删除线上页面并忽略编辑界面元数据差异', async () => {
    const { token, draftId, pages } = await prepare()
    const pageId = String(pages[0]!.pageId)
    await publish(token, draftId, [pageId], true)
    expect((await requestJson(api, 'DELETE', `/api/drafts/${draftId}/pages/${pageId}`, { token })).status).toBe(200)
    const restored = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/pages/${pageId}/restore`, { token })
    expect(restored.status, JSON.stringify(restored.body)).toBe(200)
    const overview = await requestJson(api, 'GET', `/api/drafts/${draftId}/publication`, { token })
    expect((overview.body.pages as Record<string, unknown>[]).find(page => page.pageId === pageId)?.changed).toBe(false)
    const restoredPage = restored.body.page as Record<string, unknown>
    const patch = await requestJson(api, 'PATCH', `/api/drafts/${draftId}/pages/${pageId}/editor`, { token, body: { body: restoredPage.body, expectedUpdatedAt: restoredPage.updatedAt, metadata: { editor: { version: 1 } } } })
    expect(patch.status).toBe(200)
    const unchanged = await requestJson(api, 'GET', `/api/drafts/${draftId}/publication`, { token })
    expect((unchanged.body.pages as Record<string, unknown>[]).find(page => page.pageId === pageId)?.changed).toBe(false)
    expect((await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/pages/${pageId}/restore`, { token })).status).toBe(409)
  })

  it('固定所选页面并保持未选页面及后续编辑', async () => {
    const { token, draftId, pages } = await prepare()
    const preview = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: [pages[0]!.pageId], includeSettings: true } })
    expect(preview.status, JSON.stringify(preview.body)).toBe(200)
    expect(preview.body.issues).toEqual([])
    const patch = await requestJson(api, 'PATCH', `/api/drafts/${draftId}/pages/${pages[0]!.pageId}`, { token, body: { body: { html: '<h1>后续编辑内容</h1>' } } })
    expect(patch.status).toBe(200)
    const confirm = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/confirm`, { token, body: { token: preview.body.token } })
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200)
    const publicUrl = String(confirm.body.publicUrl)
    const output = await fetch(`${publicUrl.replace(/\/$/, '')}/selected-a/`)
    expect(output.status).toBe(200)
    expect(await output.text()).not.toContain('后续编辑内容')
    expect((await fetch(`${publicUrl.replace(/\/$/, '')}/selected-b/`)).status).toBe(404)
    const listing = await requestJson(api, 'GET', `/api/drafts/${draftId}/pages`, { token })
    expect((listing.body.pages as Record<string, unknown>[])).toHaveLength(2)
    const repeated = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/confirm`, { token, body: { token: preview.body.token } })
    expect(repeated.status).toBe(200)
    expect(repeated.body.task).toEqual(confirm.body.task)
  })

  it('预检拒绝空操作、陌生页面及无权限请求', async () => {
    const { token, draftId } = await prepare()
    const empty = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: [], includeSettings: false } })
    expect(empty.status).toBe(400)
    const invalid = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: ['missing'], includeSettings: true } })
    expect(invalid.status).toBe(400)
    const another = await registerUser(api, { account: 'selected-other', password: 'selected-password', name: '其他用户' })
    expect((await requestJson(api, 'GET', `/api/drafts/${draftId}/publication`, { token: another.accessToken })).status).toBe(403)
  })

  it('停止展示和删除仅处理所选页面', async () => {
    const { token, draftId, pages } = await prepare()
    const first = await publish(token, draftId, pages.map((page) => page.pageId), true)
    for (const page of pages) expect((await fetch(`${String(first.publicUrl).replace(/\/$/, '')}/${page.slug}/`)).status).toBe(200)
    expect((await requestJson(api, 'PATCH', `/api/drafts/${draftId}/pages/${pages[0]!.pageId}`, { token, body: { status: 'unpublished' } })).status).toBe(200)
    expect((await requestJson(api, 'DELETE', `/api/drafts/${draftId}/pages/${pages[1]!.pageId}`, { token })).status).toBe(200)
    const state = await requestJson(api, 'GET', `/api/drafts/${draftId}/publication`, { token })
    const operations = state.body.pages as Record<string, unknown>[]
    expect(operations.find((page) => page.pageId === pages[0]!.pageId)!.operation).toBe('unpublish')
    expect(operations.find((page) => page.pageId === pages[1]!.pageId)!.operation).toBe('delete')
    await publish(token, draftId, [pages[0]!.pageId], false)
    expect((await fetch(`${String(first.publicUrl).replace(/\/$/, '')}/selected-a/`)).status).toBe(404)
    expect((await fetch(`${String(first.publicUrl).replace(/\/$/, '')}/selected-b/`)).status).toBe(200)
    await publish(token, draftId, [pages[1]!.pageId], false)
    expect((await fetch(`${String(first.publicUrl).replace(/\/$/, '')}/selected-b/`)).status).toBe(404)
  })

  it('仅设置发布保留线上正文，后续页面发布保留未确认设置', async () => {
    const { token, draftId, pages } = await prepare()
    const first = await publish(token, draftId, [pages[0]!.pageId], true)
    await requestJson(api, 'PATCH', `/api/drafts/${draftId}/pages/${pages[0]!.pageId}`, { token, body: { body: { html: '<h1>未确认正文</h1>' } } })
    const settings = await requestJson(api, 'PATCH', `/api/drafts/${draftId}/settings`, { token, body: { whatsappEnabled: true, whatsappNumber: '12345678901', whatsappLabel: '联系网站' } })
    expect(settings.status, JSON.stringify(settings.body)).toBe(200)
    await publish(token, draftId, [], true)
    const html = await (await fetch(`${String(first.publicUrl).replace(/\/$/, '')}/selected-a/`)).text()
    expect(html).not.toContain('未确认正文')
    expect(html).toContain('联系网站')
    await requestJson(api, 'PATCH', `/api/drafts/${draftId}/settings`, { token, body: { whatsappLabel: '未确认设置' } })
    await publish(token, draftId, [pages[0]!.pageId], false)
    const updated = await (await fetch(`${String(first.publicUrl).replace(/\/$/, '')}/selected-a/`)).text()
    expect(updated).toContain('未确认正文')
    expect(updated).not.toContain('未确认设置')
  })

  it('确认时拒绝过期令牌及已经撤销的网站权限', async () => {
    const { token, draftId, pages } = await prepare()
    const preview = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: [pages[0]!.pageId], includeSettings: true } })
    expect(preview.status).toBe(200)
    await pool.query(`UPDATE selected_publication_tasks SET expires_at=NOW()-INTERVAL '1 second' WHERE draft_id=$1`, [draftId])
    expect((await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/confirm`, { token, body: { token: preview.body.token } })).status).toBe(410)
    await pool.query(`UPDATE selected_publication_tasks SET expires_at=NOW()+INTERVAL '1 hour' WHERE draft_id=$1`, [draftId])
    await pool.query(`DELETE FROM site_owners WHERE site_id=(SELECT site_id FROM site_drafts WHERE draft_id=$1)`, [draftId])
    expect((await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/confirm`, { token, body: { token: preview.body.token } })).status).toBe(403)
  })

  it('确认前线上变化需要重新预检，过时页面基础版本不能覆盖线上内容', async () => {
    const { token, draftId, pages } = await prepare()
    const first = await publish(token, draftId, [pages[0]!.pageId], true)
    const siteId = String((first.site as Record<string, unknown>).siteId)
    const fork = await requestJson(api, 'POST', '/api/drafts', { token, body: { name: '协作草稿', siteId } })
    expect(fork.status).toBe(201)
    const forkId = String((fork.body.draft as Record<string, unknown>).draftId)
    const preview = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: [pages[1]!.pageId], includeSettings: false } })
    expect(preview.status).toBe(200)
    await requestJson(api, 'PATCH', `/api/drafts/${forkId}/pages/${pages[0]!.pageId}`, { token, body: { body: { html: '<h1>其他成员的新内容</h1>' } } })
    await publish(token, forkId, [pages[0]!.pageId], false)
    expect((await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/confirm`, { token, body: { token: preview.body.token } })).status).toBe(409)
    await requestJson(api, 'PATCH', `/api/drafts/${draftId}/pages/${pages[0]!.pageId}`, { token, body: { body: { html: '<h1>旧基础版本编辑</h1>' } } })
    const conflicted = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: [pages[0]!.pageId], includeSettings: false } })
    expect(conflicted.status).toBe(200)
    expect((conflicted.body.issues as Record<string, unknown>[]).some((issue) => issue.code === 'PAGE_VERSION_CONFLICT')).toBe(true)
    expect(conflicted.body.token).toBeNull()
  })

  it('网站入口关联历史草稿并允许未发布网站创建草稿', async () => {
    const { token, draftId } = await prepare()
    const listed = await requestJson(api, 'GET', '/api/managed-sites', { token })
    expect(listed.status).toBe(200)
    const sites = listed.body.sites as Record<string, unknown>[]
    expect(sites).toHaveLength(1)
    expect((sites[0]!.drafts as Record<string, unknown>[])[0]!.draftId).toBe(draftId)
    const second = await requestJson(api, 'POST', '/api/drafts', { token, body: { name: '网站新草稿', siteId: sites[0]!.siteId } })
    expect(second.status, JSON.stringify(second.body)).toBe(201)
    expect((second.body.draft as Record<string, unknown>).siteId).toBe(sites[0]!.siteId)
  })

  it('所选页面发布所需图片，未选图片不进入公开文件或Git历史', async () => {
    const { token, draftId, pages } = await prepare()
    const assets: string[] = []
    for (const [index, color] of ['#123456', '#abcdef'].entries()) {
      const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: color } }).png().toBuffer()
      const form = new FormData()
      form.append('file', new File([new Uint8Array(bytes)], 'product.png', { type: 'image/png' }))
      const upload = await api.request(`/api/drafts/${draftId}/assets`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
      expect(upload.status).toBe(201)
      const asset = (await upload.json()).asset
      assets.push(String(asset.url))
      const patch = await requestJson(api, 'PATCH', `/api/drafts/${draftId}/pages/${pages[index]!.pageId}`, { token,
        body: { body: { html: `<picture><source srcset="${asset.url} 1x"><img src="${asset.url}"></picture><div style="background:url('${asset.url}')"></div>` } } })
      expect(patch.status).toBe(200)
    }
    const first = await publish(token, draftId, [pages[0]!.pageId], true)
    const base = String(first.publicUrl).replace(/\/$/, '')
    expect((await fetch(`${base}${assets[0]}`)).status).toBe(200)
    expect((await fetch(`${base}${assets[1]}`)).status).toBe(404)
    const stored = (await pool.query(`SELECT snapshot FROM selected_publication_tasks WHERE draft_id=$1 AND status='completed'`, [draftId])).rows[0]!
    expect(JSON.stringify(stored.snapshot)).not.toContain(assets[1])
    await publish(token, draftId, [pages[1]!.pageId], false)
    expect((await fetch(`${base}${assets[0]}`)).status).toBe(200)
    expect((await fetch(`${base}${assets[1]}`)).status).toBe(200)
  })

  it('远端发布成功后数据库写入失败可以核对恢复，并阻止其他发布', async () => {
    const { token, draftId, pages } = await prepare()
    const preview = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: [pages[0]!.pageId], includeSettings: true } })
    expect(preview.status).toBe(200)
    await pool.query(`CREATE FUNCTION reject_selected_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'publication-local-write-unavailable'; END; $$`)
    await pool.query(`CREATE TRIGGER reject_selected_publication BEFORE UPDATE OF published_commit_id ON sites FOR EACH ROW EXECUTE FUNCTION reject_selected_publication()`)
    const failure = await api.request(`/api/drafts/${draftId}/publication/confirm`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: preview.body.token }) })
    expect(failure.status).toBe(503)
    expect((await failure.json()).taskId).toBe(preview.body.taskId)
    const task = (await pool.query(`SELECT * FROM selected_publication_tasks WHERE draft_id=$1`, [draftId])).rows[0]!
    expect(task.status).toBe('reconciling')
    const url = (await pool.query(`SELECT public_url FROM sites WHERE site_id=$1`, [task.site_id])).rows[0]!.public_url
    expect((await fetch(`${String(url).replace(/\/$/, '')}/selected-a/`)).status).toBe(200)
    await pool.query(`DROP TRIGGER reject_selected_publication ON sites`)
    await pool.query(`DROP FUNCTION reject_selected_publication()`)
    const recovery = await requestJson(api, 'GET', `/api/drafts/${draftId}/publication/tasks/${task.task_id}`, { token })
    expect(recovery.status, JSON.stringify(recovery.body)).toBe(200)
    expect(recovery.body.task).toMatchObject({ taskId: task.task_id, status: 'completed', publishedCommitId: task.candidate_commit_id })
    expect((await pool.query(`SELECT published_commit_id FROM sites WHERE site_id=$1`, [task.site_id])).rows[0]!.published_commit_id).toBe(task.candidate_commit_id)
  })

  it('失去网站发布权限仍能读取本人草稿和网站入口', async () => {
    const { token, draftId, pages } = await prepare()
    const first = await publish(token, draftId, [pages[0]!.pageId], true)
    const siteId = String((first.site as Record<string, unknown>).siteId)
    await pool.query(`DELETE FROM site_owners WHERE site_id=$1`, [siteId])
    expect((await requestJson(api, 'GET', `/api/drafts/${draftId}/publication`, { token })).status).toBe(200)
    const managed = await requestJson(api, 'GET', '/api/managed-sites', { token })
    expect(managed.status).toBe(200)
    expect((managed.body.sites as Record<string, unknown>[])[0]).toMatchObject({ siteId, canPublish: false })
    expect((await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: [pages[1]!.pageId], includeSettings: false } })).status).toBe(403)
  })

  it('网站设置的过时基础版本需要同步后重新预检', async () => {
    const { token, draftId, pages } = await prepare()
    const first = await publish(token, draftId, [pages[0]!.pageId], true)
    const fork = await requestJson(api, 'POST', '/api/drafts', { token, body: { name: '设置协作', siteId: (first.site as Record<string, unknown>).siteId } })
    const forkId = String((fork.body.draft as Record<string, unknown>).draftId)
    await requestJson(api, 'PATCH', `/api/drafts/${forkId}/settings`, { token, body: { whatsappLabel: '线上网站设置' } })
    await publish(token, forkId, [], true)
    await requestJson(api, 'PATCH', `/api/drafts/${draftId}/settings`, { token, body: { whatsappLabel: '旧草稿网站设置' } })
    const conflicted = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: [], includeSettings: true } })
    expect(conflicted.status).toBe(200)
    expect(conflicted.body.token).toBeNull()
    expect((conflicted.body.issues as Record<string, unknown>[]).some((issue) => issue.code === 'SETTINGS_VERSION_CONFLICT')).toBe(true)
  })

  it('稳定pageId链接需要选择目标页面，公开链接使用网站路径', async () => {
    const { token, draftId, pages } = await prepare()
    await requestJson(api, 'PATCH', `/api/drafts/${draftId}/pages/${pages[0]!.pageId}`, { token, body: { body: { html: `<a data-olps-page-link="${pages[1]!.pageId}" href="/stale-target/">查看目标</a>` } } })
    const blocked = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: [pages[0]!.pageId], includeSettings: true } })
    expect(blocked.status).toBe(200)
    expect(blocked.body.token).toBeNull()
    expect(blocked.body.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PAGE_REFERENCE_MISSING', pageId: pages[0]!.pageId })]))
    const published = await publish(token, draftId, pages.map((page) => page.pageId), true)
    const base = String(published.publicUrl).replace(/\/$/, '')
    const html = await (await fetch(`${base}/selected-a/`)).text()
    const path = new URL(`${base}/selected-b/`).pathname
    expect(html).toContain(`href="${path}"`)
    expect(html).not.toContain('href="/stale-target/"')
  })

  it('历史发布快照依据远端固定版本补充完整页面并保留未选正文', async () => {
    const { token, draftId, pages } = await prepare()
    const first = await publish(token, draftId, pages.map((page) => page.pageId), true)
    const siteId = String((first.site as Record<string, unknown>).siteId)
    await pool.query(`UPDATE site_published_pages SET source_page=NULL,body='{"html":"<h1>待核对快照</h1>"}'::jsonb WHERE site_id=$1 AND page_id=$2`, [siteId, pages[1]!.pageId])
    await requestJson(api, 'PATCH', `/api/drafts/${draftId}/pages/${pages[0]!.pageId}`, { token, body: { body: { html: '<h1>本次所选正文</h1>' } } })
    await publish(token, draftId, [pages[0]!.pageId], false)
    const live = await (await fetch(`${String(first.publicUrl).replace(/\/$/, '')}/selected-b/`)).text()
    expect(live).toContain('<h1>selected-b</h1>')
    expect(live).not.toContain('待核对快照')
    const row = (await pool.query(`SELECT source_page FROM site_published_pages WHERE site_id=$1 AND page_id=$2`, [siteId, pages[1]!.pageId])).rows[0]!
    expect(row.source_page.body.html).toBe('<h1>selected-b</h1>')
    expect(row.source_page.updatedAt).toBeTruthy()
  })

  it('同网站其他所有者可以核对活跃发布，私有预检与其他网站保持隔离', async () => {
    const { token, draftId, pages } = await prepare()
    const first = await publish(token, draftId, [pages[0]!.pageId], true)
    const siteId = String((first.site as Record<string, unknown>).siteId)
    const member = await registerUser(api, { account: 'publication-recovery-owner', password: 'selected-password', name: '核对用户' })
    expect((await requestJson(api, 'POST', `/api/sites/${siteId}/owners`, { token, body: { account: 'publication-recovery-owner' } })).status).toBe(200)
    const fork = await requestJson(api, 'POST', '/api/drafts', { token: member.accessToken, body: { name: '核对草稿', siteId } })
    const forkId = String((fork.body.draft as Record<string, unknown>).draftId)
    const privatePreview = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: [pages[1]!.pageId], includeSettings: false } })
    await requestJson(api, 'PATCH', `/api/drafts/${draftId}/pages/${pages[0]!.pageId}`, { token, body: { body: { html: '<h1>等待核对内容</h1>' } } })
    const preview = await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/preview`, { token, body: { pageIds: [pages[0]!.pageId], includeSettings: false } })
    expect(preview.status).toBe(200)
    await pool.query(`CREATE FUNCTION reject_recovery_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'recovery-local-write-unavailable'; END; $$`)
    await pool.query(`CREATE TRIGGER reject_recovery_write BEFORE UPDATE OF published_commit_id ON sites FOR EACH ROW EXECUTE FUNCTION reject_recovery_write()`)
    expect((await requestJson(api, 'POST', `/api/drafts/${draftId}/publication/confirm`, { token, body: { token: preview.body.token } })).status).toBe(503)
    await pool.query(`DROP TRIGGER reject_recovery_write ON sites`)
    await pool.query(`DROP FUNCTION reject_recovery_write()`)
    await pool.query(`DELETE FROM site_owners WHERE site_id=$1 AND user_id=(SELECT user_id FROM users WHERE account='selected-owner')`, [siteId])
    await pool.query(`DELETE FROM draft_owners WHERE draft_id=$1 AND user_id=(SELECT user_id FROM users WHERE account='selected-owner')`, [draftId])
    const listing = await requestJson(api, 'GET', `/api/drafts/${forkId}/publication/tasks`, { token: member.accessToken })
    expect(listing.status).toBe(200)
    const visible = listing.body.tasks as Record<string, unknown>[]
    expect(visible.some((task) => task.taskId === preview.body.taskId)).toBe(true)
    expect(visible.some((task) => task.taskId === privatePreview.body.taskId)).toBe(false)
    expect((await requestJson(api, 'GET', `/api/drafts/${forkId}/publication/tasks/${privatePreview.body.taskId}`, { token: member.accessToken })).status).toBe(404)
    const other = await requestJson(api, 'POST', '/api/drafts', { token: member.accessToken, body: { name: '其他网站' } })
    const otherId = String((other.body.draft as Record<string, unknown>).draftId)
    expect((await requestJson(api, 'GET', `/api/drafts/${otherId}/publication/tasks/${preview.body.taskId}`, { token: member.accessToken })).status).toBe(404)
    const restored = await requestJson(api, 'GET', `/api/drafts/${forkId}/publication/tasks/${preview.body.taskId}`, { token: member.accessToken })
    expect(restored.status, JSON.stringify(restored.body)).toBe(200)
    expect(restored.body.task).toMatchObject({ taskId: preview.body.taskId, status: 'completed' })
    const history = await requestJson(api, 'GET', `/api/drafts/${forkId}/publication/tasks`, { token: member.accessToken })
    expect((history.body.tasks as Record<string, unknown>[]).some((task) => task.taskId === preview.body.taskId && task.status === 'completed')).toBe(true)
    expect((await requestJson(api, 'POST', `/api/drafts/${forkId}/publication/confirm`, { token: member.accessToken, body: { token: preview.body.token } })).status).toBe(404)
    const live = await (await fetch(`${String(first.publicUrl).replace(/\/$/, '')}/selected-a/`)).text()
    expect(live).toContain('等待核对内容')
  })
})

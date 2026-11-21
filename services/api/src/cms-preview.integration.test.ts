import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { expect, it } from 'vitest'
import { migrateWithClient } from './db-schema.js'
import { migrateCmsSchema } from './cms-schema.js'
import { createCmsSite, initializeCmsSite } from './cms-sites.js'
import { CmsPreviewService, createCmsPreviewSchema } from './cms-preview.js'

it('整站预览绑定会话与权限，包含每页一个管理入口且不改公开产物', async () => {
  const url = process.env.TEST_DATABASE_URL!
  if (!new URL(url).pathname.includes('_test_')) throw new Error('只允许专用测试数据库')
  const schema = `preview_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const database = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
  const client = await database.connect()
  const root = path.resolve('../../.intermediate/cms-preview-tests', schema)
  try {
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','测试用户',NOW(),NOW())")
    await migrateCmsSchema(client)
    await createCmsPreviewSchema(client)
    const site = await createCmsSite('owner', 'Preview', database, path.join(root, 'sandboxes'))
    await initializeCmsSite('owner', site.siteId, database, path.join(root, 'sandboxes'), 'http://127.0.0.1:8787')
    await client.query("INSERT INTO sessions VALUES('session','owner',$1,NOW()+INTERVAL '1 hour',NOW())", [createHash('sha256').update('token').digest('hex')])
    const sandboxId = (await client.query('SELECT sandbox_id FROM site_drafts WHERE draft_id=$1', [site.draftId])).rows[0].sandbox_id
    const workspace = path.join(root, 'sandboxes', sandboxId)
    const original = await fs.readFile(path.join(workspace, 'public/en/index.html'), 'utf8')
    expect(original).toContain('olps-tracking-config')
    expect(original).not.toContain('data-olps-admin-bar')
    const previews = new CmsPreviewService(database, path.join(root, 'sandboxes'), path.join(root, 'previews'))
    const created = await previews.create('owner', 'session', site.draftId, { locale: 'en', returnPath: '/pages' })
    const token = created.previewUrl.split('/')[2]
    const home = await previews.read(token, 'en/')
    expect((await client.query('SELECT token_hash FROM cms_preview_capabilities')).rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'))
    for (const unsafe of ['../source/site-settings.json','%2e%2e/source/site-settings.json','en/../../source/site-settings.json','en\\index.html']) await expect(previews.read(token,unsafe)).rejects.toThrow('PREVIEW_FORBIDDEN')
    const capability=(await client.query('SELECT capability_id FROM cms_preview_capabilities')).rows[0].capability_id
    const outside=path.join(root,'outside.txt')
    await fs.writeFile(outside,'受保护内容')
    await fs.symlink(outside,path.join(root,'previews',capability,'public','external.txt'))
    await expect(previews.read(token,'external.txt')).rejects.toThrow('PREVIEW_FORBIDDEN')
    await expect(previews.read('unknown-token','en/')).rejects.toThrow('PREVIEW_FORBIDDEN')
    await expect(previews.create('owner','session',site.draftId,{locale:'de',returnPath:'/pages'})).rejects.toThrow('PREVIEW_LOCALE_INVALID')
    expect(home.content.toString().match(/data-olps-admin-bar/g)).toHaveLength(1)
    expect(home.content.toString()).toContain('测试用户')
    expect(home.content.toString()).toContain('返回后台')
    expect(home.content.toString()).not.toContain('olps-tracking')
    const contactHtml = (await previews.read(token, 'en/contact/')).content.toString()
    expect(contactHtml.match(/data-olps-admin-bar/g)).toHaveLength(1)
    expect(contactHtml).toContain(`/api/preview-access/${token}/inquiries`)
    expect(contactHtml).toContain('data-olps-form-id=')
    expect(contactHtml).not.toContain('olps-tracking-config')
    expect(await fs.readFile(path.join(workspace, 'public/en/index.html'), 'utf8')).toBe(original)
    await expect(previews.create('owner', 'session', site.draftId, { locale: 'en', returnPath: '//evil.example' })).rejects.toThrow()
    await client.query('DELETE FROM draft_owners WHERE draft_id=$1', [site.draftId])
    await expect(previews.read(token, 'en/')).rejects.toThrow('PREVIEW_FORBIDDEN')
    await client.query("INSERT INTO draft_owners VALUES($1,'owner',NOW())", [site.draftId])
    await client.query("UPDATE cms_preview_capabilities SET expires_at=NOW()-INTERVAL '1 second'")
    await expect(previews.read(token, 'en/')).rejects.toThrow('PREVIEW_FORBIDDEN')
    const second = await previews.create('owner', 'session', site.draftId, { locale: 'en', returnPath: '/pages' })
    await client.query("DELETE FROM sessions WHERE session_id='session'")
    await expect(previews.read(second.previewUrl.split('/')[2], 'en/')).rejects.toThrow('PREVIEW_FORBIDDEN')
  } finally {
    client.release()
    await database.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
    await fs.rm(root, { recursive: true, force: true })
  }
}, 120_000)

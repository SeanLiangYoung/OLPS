import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { zipSync, strToU8 } from 'fflate'
import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { SyncWorkspace } from '@olps/sync'
import { createDefaultSiteContent } from '@olps/domain'
import {classifyAssetsOnly,buildSite,buildPreview} from '@olps/site-builder'
import { migrateWithClient } from './db-schema.js'
import { migrateCmsSchema } from './cms-schema.js'
import { createUnpublishedSite } from './site-lifecycle.js'
import { initializeCmsSite } from './cms-sites.js'
import { uploadMedia, readMedia, mediaUsages, deleteMedia, mediaRoutes } from './media-routes.js'
import { installPackage } from './package-install.js'
import { setPluginEnabled, savePluginSettings, readPluginSettings, deletePlugin, pluginRoutes } from './plugin-routes.js'
import { setActiveTheme, deleteTheme, themeRoutes } from './theme-routes.js'
import { createCredentialSchema, decryptCredential,encryptCredential } from './credentials.js'

it('媒体、主题与插件通过真实文件、PostgreSQL和isolate工作', async () => {
  const url = process.env.TEST_DATABASE_URL!
  if (!new URL(url).pathname.includes('_test_')) throw new Error('只允许测试数据库')
  const schema = `resources_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const database = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
  const client = await database.connect()
  const sandboxRoot = path.resolve('.intermediate/resource-tests', randomUUID())
  try {
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    await migrateCmsSchema(client)
    await createCredentialSchema(client)
    const site = await createUnpublishedSite({ userId: 'owner', name: 'Resources', settings: {}, sandboxId: randomUUID() }, database)
    expect(await initializeCmsSite('owner', site.siteId, database, sandboxRoot, 'http://127.0.0.1:8787')).toEqual({ initStatus: 'ready' })
    const row = (await client.query('SELECT sandbox_id FROM site_drafts WHERE draft_id=$1', [site.draftId])).rows[0]
    const workspace = await SyncWorkspace.open({ sandboxRoot, draftId: row.sandbox_id, remote: { baseUrl: process.env.REMOTE_SERVICE_URL!, token: process.env.REMOTE_SERVICE_TOKEN! } })
    const context = { database, workspace, draftId: site.draftId, userId: 'owner' }
    await client.query('INSERT INTO plugin_secrets(draft_id,site_id,plugin_id,ciphertext) VALUES($1,$2,$3,$4)',[site.draftId,site.siteId,'google-maps',encryptCredential(JSON.stringify({apiKey:'PRIVATE_MAPS_SERVER_KEY'}),`${site.siteId}/google-maps`)])
    const originalMaps=await readPluginSettings(context,'google-maps')
    expect(JSON.stringify(originalMaps)).not.toContain('PRIVATE_MAPS_SERVER_KEY')
    expect(originalMaps.settings.browserApiKey).toBeUndefined()
    await savePluginSettings(context,'google-maps',{browserApiKey:'local-browser-embed-key'},{},originalMaps.revision)
    expect((await client.query("SELECT 1 FROM plugin_secrets WHERE draft_id=$1 AND plugin_id='google-maps'",[site.draftId])).rowCount).toBe(0)
    const originalWhatsApp=await readPluginSettings(context,'whatsapp')
    await savePluginSettings(context,'whatsapp',{phone:'8613800138000',buttonLabel:{en:'Contact our team','zh-CN':'联系团队'},position:'bottom-left'},{},originalWhatsApp.revision)
    await buildPreview(workspace.getState().workspacePath)
    expect(await workspace.readFile('public/en/index.html').then(bytes=>bytes.toString())).toContain('https://wa.me/8613800138000')
    await buildSite(workspace.getState().workspacePath)
    expect(await workspace.readFile('public/zh-CN/index.html').then(bytes=>bytes.toString())).toContain('联系团队')
    const defaults = createDefaultSiteContent()
    await workspace.writeFile('source/site-settings.json', Buffer.from(JSON.stringify(defaults.settings)))
    await workspace.writeFile('source/appearance.json', Buffer.from(JSON.stringify({ schemaVersion: 1, themeId: 'starter', themeSettings: {}, menus: {} })))
    await workspace.writeFile('source/plugins.json', Buffer.from(JSON.stringify({ schemaVersion: 1, plugins: {} })))
    const createImage = () => sharp({ create: { width: 32, height: 24, channels: 3, background: '#336699' } })
    const pdf = await PDFDocument.create()
    pdf.addPage([100, 100])
    const bytes = new Map<string, Buffer>([
      ['png', await createImage().png().toBuffer()], ['jpg', await createImage().jpeg().toBuffer()], ['jpeg', await createImage().jpeg().toBuffer()], ['webp', await createImage().webp().toBuffer()], ['gif', await createImage().gif().toBuffer()],
      ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><script>alert(1)</script><rect width="32" height="24" fill="blue"/></svg>')], ['pdf', Buffer.from(await pdf.save())],
    ])
    for (const extension of ['mp4', 'webm']) {
      const destination = path.join(sandboxRoot, `video.${extension}`)
      const result = spawnSync(process.env.FFMPEG_COMMAND ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=16x16:d=0.1', '-y', destination], { encoding: 'utf8' })
      if (result.status !== 0) throw new Error(`真实测试视频生成失败：${result.stderr || result.error?.message}`)
      bytes.set(extension, await fs.readFile(destination))
    }
    const uploads = new Map<string, Awaited<ReturnType<typeof uploadMedia>>>()
    for (const [extension, content] of bytes) {
      const uploaded = await uploadMedia(context, { fileName: `media.${extension}`, content })
      uploads.set(extension, uploaded)
      expect(uploaded.media.mimeType).toBe(extension === 'svg' ? 'image/svg+xml' : extension === 'pdf' ? 'application/pdf' : ['mp4', 'webm'].includes(extension) ? `video/${extension}` : ['jpg', 'jpeg'].includes(extension) ? 'image/jpeg' : `image/${extension}`)
      expect((await readMedia(context, uploaded.media.mediaId)).revision).toBe(uploaded.revision)
    }
    const svg = uploads.get('svg')!
    expect((await workspace.readFile(svg.media.path)).toString()).not.toContain('<script')
    await expect(uploadMedia(context, { fileName: 'invalid.png', content: bytes.get('pdf')! })).rejects.toThrow('VALIDATION_FAILED')
    const pdfMedia = uploads.get('pdf')!
    await deleteMedia(context, pdfMedia.media.mediaId, pdfMedia.revision)
    await expect(readMedia(context, pdfMedia.media.mediaId)).rejects.toThrow('NOT_FOUND')
    expect((await client.query('SELECT 1 FROM media WHERE draft_id=$1 AND media_id=$2', [site.draftId, pdfMedia.media.mediaId])).rowCount).toBe(0)
    const beforeFailureFiles = await workspace.listFiles('source/media')
    const beforeFailureRows = (await client.query('SELECT * FROM media ORDER BY media_id')).rows
    await client.query("ALTER TABLE media ADD CONSTRAINT require_nonnegative_bytes CHECK((data->>'size')::int>0 AND data->>'mimeType'<>'image/gif') NOT VALID")
    await expect(uploadMedia(context, { fileName: 'blocked.gif', content: bytes.get('gif')! })).rejects.toThrow()
    expect(await workspace.listFiles('source/media')).toEqual(beforeFailureFiles)
    expect((await client.query('SELECT * FROM media ORDER BY media_id')).rows).toEqual(beforeFailureRows)
    await client.query('ALTER TABLE media DROP CONSTRAINT require_nonnegative_bytes')
    const png = uploads.get('png')!
    const assetBaseline=path.join(sandboxRoot,'asset-baseline')
    await fs.cp(workspace.getState().workspacePath,assetBaseline,{recursive:true})
    let replacement = await uploadMedia(context, { fileName: 'replacement.png', content: await createImage().negate().png().toBuffer() }, { mediaId: png.media.mediaId, revision: png.revision })
    expect(replacement.media.mediaId).toBe(png.media.mediaId)
    expect(replacement.media.path).toBe(png.media.path)
    expect(replacement.media.updatedAt).toBe(png.media.updatedAt)
    expect(replacement.media.uploadedAt).not.toBe(png.media.uploadedAt)
    expect((await classifyAssetsOnly(assetBaseline,workspace.getState().workspacePath)).kind).toBe('assets_only')
    const resized=await uploadMedia(context,{fileName:'resized.png',content:await createImage().resize(19,17).png().toBuffer()},{mediaId:png.media.mediaId,revision:replacement.revision})
    expect((await classifyAssetsOnly(assetBaseline,workspace.getState().workspacePath)).kind).toBe('full')
    replacement=await uploadMedia(context,{fileName:'replacement.png',content:await createImage().negate().png().toBuffer()},{mediaId:png.media.mediaId,revision:resized.revision})
    await expect(uploadMedia(context, { fileName: 'stale.png', content: bytes.get('png')! }, { mediaId: png.media.mediaId, revision: png.revision })).rejects.toThrow('REVISION_CONFLICT')
    const settings = { ...defaults.settings, iconMediaId: png.media.mediaId }
    await workspace.writeFile('source/site-settings.json', Buffer.from(JSON.stringify(settings)))
    await workspace.writeFile('source/appearance.json', Buffer.from(JSON.stringify({ schemaVersion: 1, themeId: 'starter', themeSettings: { logo: { mediaId: png.media.mediaId } }, menus: {} })))
    const pageId = randomUUID()
    await fs.mkdir(path.join(workspace.getState().workspacePath, 'source/pages', pageId), { recursive: true })
    await workspace.writeFile(`source/pages/${pageId}/en.json`, Buffer.from(JSON.stringify({ schemaVersion: 1, locale: 'en', slug: 'resources', title: 'Resources', summary: '', cover: null, seo: { title: '', description: '', ogImage: null }, blocks: [{ id: 'image', type: 'core/image', props: { image: { mediaId: png.media.mediaId } }, children: [] }], sourceHash: null, updatedAt: new Date().toISOString() })))
    expect(await mediaUsages(context, png.media.mediaId)).toHaveLength(3)
    await expect(deleteMedia(context, png.media.mediaId, replacement.revision)).rejects.toMatchObject({ code: 'RESOURCE_IN_USE', details: { count: 3 } })

    const plugin = { schemaVersion: 1, id: 'private-service', name: 'Private Service', version: '1', author: 'OLPS', description: '', requires: '1', settings: [{ key: 'apiKey', type: 'secret', label: 'API key', required: false, translatable: false }, { key: 'label', type: 'text', label: 'Label', required: false, translatable: true }], snippets: [], assets: [], server: { api: 'server/api.js' }, permissions: { store: true } }
    const pluginZip = Buffer.from(zipSync({ 'plugin.json': strToU8(JSON.stringify(plugin)), 'server/api.js': strToU8('exports.handle=async function(){return {status:200,headers:{},body:"ready"}}') }))
    await installPackage(context, pluginZip, 'plugin')
    await expect(setPluginEnabled(context, plugin.id, true, false)).rejects.toThrow('PERMISSIONS_REQUIRED')
    await setPluginEnabled(context, plugin.id, true, true)
    const before = await readPluginSettings(context, plugin.id)
    let saved = await savePluginSettings(context, plugin.id, { label: {en:'Service','zh-CN':'服务'} }, { apiKey: 'SENSITIVE_ACCOUNT_KEY' }, before.revision)
    expect(saved.settings.label).toEqual({en:'Service','zh-CN':'服务'})
    await expect(savePluginSettings(context,plugin.id,{label:{ja:'サービス'}},{},saved.revision)).rejects.toThrow()
    await expect(savePluginSettings(context,plugin.id,{label:{en:42}},{},saved.revision)).rejects.toThrow()
    expect((await readPluginSettings(context,plugin.id)).revision).toBe(saved.revision)
    expect(JSON.stringify(saved)).not.toContain('SENSITIVE_ACCOUNT_KEY')
    expect((await workspace.readFile('source/plugins.json')).toString()).not.toContain('SENSITIVE_ACCOUNT_KEY')
    const stored = (await client.query('SELECT ciphertext FROM plugin_secrets WHERE draft_id=$1 AND plugin_id=$2', [site.draftId, plugin.id])).rows[0].ciphertext
    expect(stored).not.toContain('SENSITIVE_ACCOUNT_KEY')
    expect(JSON.parse(decryptCredential(stored, `${site.siteId}/${plugin.id}`)).apiKey).toBe('SENSITIVE_ACCOUNT_KEY')
    await expect(savePluginSettings(context, plugin.id, { label: 'Service' }, { apiKey: 'STALE_KEY' }, before.revision)).rejects.toThrow('REVISION_CONFLICT')
    const singleConnection=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`,max:1,connectionTimeoutMillis:1500})
    try{
      const constrainedContext={...context,database:singleConnection}
      const [readResult,writeResult]=await Promise.allSettled([readPluginSettings(constrainedContext,plugin.id),savePluginSettings(constrainedContext,plugin.id,{}, {apiKey:'SINGLE_CONNECTION_KEY'},saved.revision)])
      expect([readResult,writeResult].map(result=>result.status==='fulfilled'?'fulfilled':String(result.reason))).toEqual(['fulfilled','fulfilled'])
      if(writeResult.status!=='fulfilled')throw writeResult.reason
      saved=writeResult.value
      const reread=await readPluginSettings(constrainedContext,plugin.id)
      expect(reread.secrets).toEqual({apiKey:true})
      expect(reread.revision).toBe(saved.revision)
      expect(JSON.stringify(reread)).not.toContain('SINGLE_CONNECTION_KEY')
    }finally{await singleConnection.end()}
    const secretOnly = await savePluginSettings(context, plugin.id, {}, { apiKey: 'UPDATED_ACCOUNT_KEY' }, saved.revision)
    expect(secretOnly.revision).not.toBe(saved.revision)
    const upgraded = Buffer.from(zipSync({ 'plugin.json': strToU8(JSON.stringify({ ...plugin, version: '2', permissions: { store: true, inquiries: true } })), 'server/api.js': strToU8('exports.handle=async function(){return {status:200,headers:{},body:"ready"}}') }))
    expect((await installPackage(context, upgraded, 'plugin')).permissionsChanged).toBe(true)
    expect((await readPluginSettings(context, plugin.id)).enabled).toBe(false)
    const theme = { schemaVersion: 1, id: 'minimal-test', name: 'Minimal', version: '1', author: 'OLPS', description: '', requires: '1', settings: [], menus: [], templates: [], styles: [] }
    const themeFiles: Record<string, Uint8Array> = { 'theme.json': strToU8(JSON.stringify(theme)) }
    for (const type of ['page', 'collection', 'group', 'item']) themeFiles[`templates/${type}.liquid`] = strToU8('<html><body>{{ content }}</body></html>')
    await installPackage(context, Buffer.from(zipSync(themeFiles)), 'theme')
    const activated = await setActiveTheme(context, theme.id, false)
    expect(activated.appearance.themeId).toBe(theme.id)
    await expect(deleteTheme(context, theme.id, activated.revision)).rejects.toThrow('RESOURCE_IN_USE')
    const pluginConfig = Buffer.from(await workspace.readFile('source/plugins.json'))
    const { resourceRevision } = await import('./managed-resource-context.js')
    await deletePlugin(context, plugin.id, resourceRevision(pluginConfig))
    expect((await client.query('SELECT 1 FROM plugin_secrets WHERE draft_id=$1 AND plugin_id=$2', [site.draftId, plugin.id])).rowCount).toBe(0)

    const app = new Hono().route('/api', mediaRoutes).route('/api', pluginRoutes).route('/api', themeRoutes)
    for (const route of [`media`, `themes`, `plugins`]) expect((await app.request(`/api/drafts/${site.draftId}/${route}`)).status).toBe(401)
  } finally {
    client.release()
    await database.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
    await fs.rm(sandboxRoot, { recursive: true, force: true })
  }
}, 120_000)

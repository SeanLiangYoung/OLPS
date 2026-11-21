import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import pg from 'pg'
import { expect, it } from 'vitest'
import { SyncWorkspace } from '@olps/sync'
import { migrateWithClient } from './db-schema.js'
import { migrateCmsSchema } from './cms-schema.js'
import { createUnpublishedSite } from './site-lifecycle.js'
import { initializeCmsSite } from './cms-sites.js'
import { createIntegrationSchema } from './integration-schema.js'
import { addSiteLocale } from './locale-routes.js'
import {createContent,saveContent} from './content-sandbox.js'
import {buildSite} from '@olps/site-builder'
import {Hono} from 'hono'
import {handleOAuthCallback} from './integration-routes.js'
import { storeOAuthState, consumeOAuthState, configureIdConnector, listIntegrations, dispatchConversion, beginOAuth, syncMarketingMetrics, promoteIntegrationScope } from './integration-routes.js'

it('真实数据库验证OAuth状态绑定、一次消费、过期和五种公开ID配置', async () => {
  const url = process.env.TEST_DATABASE_URL!
  if (!new URL(url).pathname.includes('_test_')) throw new Error('只允许测试数据库')
  const schema = `integrations_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const database = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
  const client = await database.connect()
  const sandboxRoot = path.resolve('.intermediate/integration-tests', randomUUID())
  try {
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    await migrateCmsSchema(client)
    await createIntegrationSchema(client)
    const site = await createUnpublishedSite({ userId: 'owner', name: 'Integrations', settings: {}, sandboxId: randomUUID() }, database)
    expect(await initializeCmsSite('owner', site.siteId, database, sandboxRoot, 'http://127.0.0.1:8787')).toEqual({ initStatus: 'ready' })
    const row = (await client.query('SELECT sandbox_id FROM site_drafts WHERE draft_id=$1', [site.draftId])).rows[0]
    const workspace = await SyncWorkspace.open({ sandboxRoot, draftId: row.sandbox_id, remote: { baseUrl: process.env.REMOTE_SERVICE_URL!, token: process.env.REMOTE_SERVICE_TOKEN! } })
    const context = { database, workspace, draftId: site.draftId, userId: 'owner' }
    const collectionFiles=(await workspace.listFiles('source/collections')).filter(file=>/^source\/collections\/[^/]+\.json$/.test(file))
    const definitions=await Promise.all(collectionFiles.map(async file=>JSON.parse((await workspace.readFile(file)).toString())))
    const definition=definitions.find(value=>value.prefix==='products')
    const groupId=randomUUID(),itemId=randomUUID(),now=new Date().toISOString()
    const localized={schemaVersion:1,locale:'en',slug:'localized-content',title:'Localized content',summary:'',cover:null,seo:{title:'Content',description:'Content',ogImage:null},blocks:[],sourceHash:null,updatedAt:now}
    const group={ref:'group' as const,collectionId:definition.collectionId,meta:{schemaVersion:1,groupId,parentGroupId:null,levelId:definition.levels[0].levelId,order:0,status:'draft',createdAt:now,updatedAt:now},locale:{...localized,slug:'localized-group'}}
    const groupResult=await createContent(context,group)
    await saveContent(context,groupId,{...group,locale:{...group.locale,locale:'zh-CN'}},groupResult.revision)
    const item={ref:'item' as const,collectionId:definition.collectionId,meta:{schemaVersion:1,itemId,primaryGroupId:groupId,groupIds:[groupId],order:0,publishedAt:null,status:'draft',fields:{model:'Locale model'},createdAt:now,updatedAt:now},locale:{...localized,slug:'localized-item',fields:{}}}
    const itemResult=await createContent(context,item)
    await saveContent(context,itemId,{...item,locale:{...item.locale,locale:'zh-CN'}},itemResult.revision)
    const added = await addSiteLocale(context, 'fr', 'ltr')
    expect(added.created).toBe(13)
    expect(JSON.parse((await workspace.readFile('source/site-settings.json')).toString()).locales).toContainEqual({ code: 'fr', dir: 'ltr' })
    const localizedPages = (await workspace.listFiles('source/pages')).filter(file => file.endsWith('/fr.json'))
    expect(localizedPages).toHaveLength(8)
    for (const file of localizedPages) expect(JSON.parse((await workspace.readFile(file)).toString()).sourceHash).toBeNull()
    expect((await client.query("SELECT 1 FROM collection_groups WHERE locale='fr'")).rowCount).toBe(1)
    expect((await client.query("SELECT 1 FROM collection_items WHERE locale='fr'")).rowCount).toBe(1)
    await buildSite(workspace.getState().workspacePath)
    expect(await fs.readFile(path.join(workspace.getState().workspacePath,'public/fr/index.html'),'utf8')).toContain('lang="fr"')
    await expect(addSiteLocale(context, 'fr', 'ltr')).rejects.toThrow('VALIDATION_FAILED')
    await expect(addSiteLocale(context,'invalid_locale','ltr')).rejects.toThrow('VALIDATION_FAILED')
    const beforeLocaleFailure=await workspace.readFile('source/site-settings.json')
    await client.query("ALTER TABLE collection_indexes ADD CONSTRAINT reject_test_locale CHECK(locale<>'de') NOT VALID")
    await expect(addSiteLocale(context,'de','ltr')).rejects.toThrow()
    expect((await workspace.readFile('source/site-settings.json')).equals(beforeLocaleFailure)).toBe(true)
    expect((await workspace.listFiles('source')).some(file=>file.endsWith('/de.json'))).toBe(false)
    expect((await client.query("SELECT 1 FROM pages WHERE locale='de'")).rowCount).toBe(0)
    await client.query('ALTER TABLE collection_indexes DROP CONSTRAINT reject_test_locale')
    const sessionId = randomUUID()
    await client.query("INSERT INTO sessions(session_id,user_id,token_hash,expires_at,created_at) VALUES($1,'owner',$2,NOW()+INTERVAL '1 hour',NOW())", [sessionId, createHash('sha256').update(randomBytes(32)).digest('hex')])
    const verifier = randomBytes(32).toString('base64url')
    const state = await storeOAuthState(context, sessionId, 'google', verifier)
    expect(state.length).toBeGreaterThan(40)
    const stored = (await client.query('SELECT * FROM integration_oauth_states')).rows[0]
    expect(JSON.stringify(stored)).not.toContain(state)
    expect(JSON.stringify(stored)).not.toContain(verifier)
    await expect(consumeOAuthState(state, 'meta', database)).rejects.toThrow('OAUTH_STATE_INVALID')
    const consumed = await consumeOAuthState(state, 'google', database)
    expect(consumed.userId).toBe('owner')
    expect(consumed.verifier).toBe(verifier)
    await expect(consumeOAuthState(state, 'google', database)).rejects.toThrow('OAUTH_STATE_INVALID')
    const expired = await storeOAuthState(context, sessionId, 'meta', null)
    await client.query("UPDATE integration_oauth_states SET expires_at=NOW()-INTERVAL '1 minute'")
    await expect(consumeOAuthState(expired, 'meta', database)).rejects.toThrow('OAUTH_STATE_INVALID')
    const cancelled=await storeOAuthState(context,sessionId,'google',null)
    const callbacks=new Hono().get('/callback/:provider',c=>handleOAuthCallback(c,database,'http://127.0.0.1:5178'))
    const cancelledResponse=await callbacks.request(`/callback/google?state=${cancelled}&error=access_denied`)
    expect(cancelledResponse.status).toBe(303)
    const destination=new URL(cancelledResponse.headers.get('location')!)
    expect(destination.origin).toBe('http://127.0.0.1:5178')
    expect(destination.pathname).toBe('/integrations')
    expect(destination.searchParams.get('draftId')).toBe(site.draftId)
    expect(destination.searchParams.get('siteId')).toBe(site.siteId)
    expect(destination.searchParams.get('cancelled')).toBe('1')
    expect((await callbacks.request(`/callback/google?state=${cancelled}&error=access_denied`)).status).toBe(400)
    await workspace.writeFile('source/publish-config.json', Buffer.from(JSON.stringify({ schemaVersion: 1, siteId: site.siteId, publicSiteUrl: 'https://example.com', publicApiBaseUrl: 'https://api.example.com', hostingBasePath: '/', connectors: {}, conversionSettings: { submitInquiry: false, qualifiedInquiry: false }, indexNowKey: randomUUID().replaceAll('-', '') })))
    for (const [id, ids] of Object.entries({ gtm: { containerId: 'GTM-ABC123' }, tiktok: { pixelId: 'C12345678901234567890' }, linkedin: { partnerId: '12345', conversionId: '67890' }, clarity: { projectId: 'abc123' }, uet: { tagId: '12345678' } })) {
      await configureIdConnector(context, id as 'gtm', ids)
    }
    const integrations = await listIntegrations(context)
    expect(integrations.filter(item => item.status === 'connected')).toHaveLength(5)
    const published = JSON.parse((await workspace.readFile('source/publish-config.json')).toString())
    expect(Object.keys(published.connectors)).toHaveLength(5)
    expect(JSON.stringify(published)).not.toContain('accessToken')
    const preview = await dispatchConversion({ siteId: site.siteId, source: 'preview', eventId: randomUUID(), kind: 'submit', consent: { advertising: true }, dateTime: new Date().toISOString() }, database)
    expect(preview.status).toBe('blocked')
    expect((await client.query('SELECT 1 FROM conversion_deliveries')).rowCount).toBe(0)
    const noConsent=await dispatchConversion({siteId:site.siteId,source:'public',eventId:randomUUID(),kind:'submit',dateTime:new Date().toISOString(),consent:{advertising:false}},database)
    expect(noConsent).toEqual({status:'blocked',reason:'ADVERTISING_CONSENT_REQUIRED'})
    await expect(beginOAuth(context, sessionId, 'google', {})).rejects.toThrow('GOOGLE_OAUTH_CLIENT_ID')
    await expect(beginOAuth(context, sessionId, 'meta', {})).rejects.toThrow('META_APP_ID')
    const beforeMetrics = (await client.query('SELECT 1 FROM marketing_metrics')).rowCount
    await expect(syncMarketingMetrics(context, 'ga4', '2026-11-20', {})).rejects.toThrow('GOOGLE_OAUTH_CLIENT_ID')
    expect((await client.query('SELECT 1 FROM marketing_metrics')).rowCount).toBe(beforeMetrics)
    await promoteIntegrationScope(site.draftId,site.siteId,database)
    const siteConnections=(await client.query('SELECT * FROM integration_connections WHERE scope_key=$1 ORDER BY connector',[`site:${site.siteId}`])).rows
    expect(siteConnections).toHaveLength(5)
    await promoteIntegrationScope(randomUUID(),site.siteId,database)
    expect((await client.query('SELECT * FROM integration_connections WHERE scope_key=$1 ORDER BY connector',[`site:${site.siteId}`])).rows).toEqual(siteConnections)
  } finally {
    client.release()
    await database.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
    await fs.rm(sandboxRoot, { recursive: true, force: true })
  }
}, 120_000)

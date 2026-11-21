import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { expect, it } from 'vitest'
import { SyncWorkspace } from '@olps/sync'
import { loadWorkspace } from '@olps/site-builder'
import { migrateWithClient } from './db-schema.js'
import { createCmsSite, initializeCmsSite } from './cms-sites.js'
import { createCmsDraft } from './cms-drafts.js'
import { CmsPublicationService, createCmsPublicationSchema } from './cms-publication.js'
import { readPublishedContentSnapshot } from './cms-public.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { siteBuildConfig } from './site-build-config.js'
import { readContent, saveContent } from './content-sandbox.js'

it('多个真实草稿发布自动保留双方修改，并在索引失败后恢复同一次发布', async () => {
  const url = process.env.TEST_DATABASE_URL!
  if (!new URL(url).pathname.includes('_test_')) throw new Error('只允许测试数据库')
  const schema = `collaboration_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect(); await admin.query(`CREATE SCHEMA ${schema}`)
  const database = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
  const client = await database.connect()
  const root = path.resolve('../../.intermediate/cms-collaboration', schema)
  const sandboxRoot = path.join(root, 'sandboxes')
  const remote = requireRemoteServiceConfig()
  try {
    await migrateWithClient(client)
    await client.query("INSERT INTO users VALUES('owner','owner','password','Owner',NOW(),NOW())")
    const site = await createCmsSite('owner', 'Collaboration', database, sandboxRoot)
    expect(await initializeCmsSite('owner', site.siteId, database, sandboxRoot)).toEqual({ initStatus: 'ready' })
    await createCmsPublicationSchema(client)
    const publication = new CmsPublicationService(database, sandboxRoot, remote)
    const firstKey = randomUUID()
    const initial = await Promise.all([publication.publish('owner', site.siteId, site.draftId, firstKey), publication.publish('owner', site.siteId, site.draftId, firstKey)])
    expect(initial[0].commit_id).toBe(initial[1].commit_id)
    expect((await client.query('SELECT count(*) FROM publish_records')).rows[0].count).toBe('1')
    expect((await client.query('SELECT count(*) FROM sites')).rows[0].count).toBe('1')
    expect((await client.query('SELECT count(DISTINCT remote_site_id) FROM sites')).rows[0].count).toBe('1')
    for (const userId of ['writer-b','writer-c']) {
      await client.query("INSERT INTO users VALUES($1,$1,'password',$1,NOW(),NOW())",[userId])
      await client.query('INSERT INTO site_owners(site_id,user_id,created_at) VALUES($1,$2,NOW())',[site.siteId,userId])
    }
    const b = await createCmsDraft('writer-b', site.siteId, 'Version B', database, sandboxRoot)
    const c = await createCmsDraft('writer-c', site.siteId, 'Version C', database, sandboxRoot)
    async function context(draftId: string, userId: string) {
      const row = (await client.query('SELECT * FROM site_drafts WHERE draft_id=$1', [draftId])).rows[0]
      const workspace = await SyncWorkspace.open({ sandboxRoot, draftId: row.sandbox_id, remote, remoteSiteId: row.remote_site_id, baseCommitId: row.base_commit_id, headCommitId: row.head_commit_id, build: siteBuildConfig() })
      return { workspace, database, draftId, userId }
    }
    const bContext = await context(b.draftId,'writer-b')
    const cContext = await context(c.draftId,'writer-c')
    const model = (await loadWorkspace(bContext.workspace.getState().workspacePath)).model
    const aboutId = model.pages.find(page => page.meta.role === 'about')!.meta.pageId
    const homeId = model.pages.find(page => page.meta.role === 'home')!.meta.pageId
    const bPage = await readContent(bContext, 'page', aboutId, 'en')
    bPage.content.locale.summary = 'Collaboration B contribution'
    await saveContent(bContext, aboutId, bPage.content, bPage.revision)
    const cPage = await readContent(cContext, 'page', homeId, 'en')
    cPage.content.locale.title = 'Collaboration C contribution'
    cPage.content.locale.seo = { ...(cPage.content.locale.seo as Record<string, unknown>), title: 'Collaboration C contribution' }
    await saveContent(cContext, homeId, cPage.content, cPage.revision)
    await publication.publish('writer-b', site.siteId, b.draftId, randomUUID())
    const merged = await publication.publish('writer-c', site.siteId, c.draftId, randomUUID())
    expect(merged.status).toBe('completed')
    const snapshot = await readPublishedContentSnapshot(site.siteId, database)
    expect(snapshot.pages.find(page => page.meta.pageId === aboutId)!.locales.en!.summary).toBe('Collaboration B contribution')
    expect(snapshot.pages.find(page => page.meta.pageId === homeId)!.locales.en!.title).toBe('Collaboration C contribution')
    const online = await fetch(`${merged.public_url.replace(/\/$/, '')}/en/`)
    expect(online.status).toBe(200)
    expect(await online.text()).toContain('Collaboration C contribution')
    expect((await client.query('SELECT title FROM pages WHERE draft_id=$1 AND page_id=$2 AND locale=$3', [c.draftId, homeId, 'en'])).rows[0].title).toBe('Collaboration C contribution')
    const latestContext = await context(c.draftId,'writer-c')
    const next = await readContent(latestContext, 'page', homeId, 'en')
    next.content.locale.title = 'Recovered collaboration contribution'
    await saveContent(latestContext, homeId, next.content, next.revision)
    await client.query(`CREATE FUNCTION reject_cms_reindex() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CMS_REINDEX_FAILURE'; END $$`)
    await client.query('CREATE TRIGGER reject_cms_reindex BEFORE INSERT ON pages FOR EACH ROW EXECUTE FUNCTION reject_cms_reindex()')
    const recoveryKey = randomUUID()
    await expect(publication.publish('writer-c', site.siteId, c.draftId, recoveryKey)).rejects.toThrow('CMS_REINDEX_FAILURE')
    const failed = (await client.query('SELECT * FROM publish_records WHERE request_key=$1', [recoveryKey])).rows[0]
    expect(failed.status).toBe('failed')
    expect(failed.commit_id).toBeTruthy()
    expect((await client.query('SELECT status FROM site_drafts WHERE draft_id=$1', [c.draftId])).rows[0].status).toBe('error')
    await client.query('DROP TRIGGER reject_cms_reindex ON pages')
    const restartedPublication = new CmsPublicationService(database, sandboxRoot, remote)
    const recovered = await restartedPublication.publish('writer-c', site.siteId, c.draftId, recoveryKey)
    expect(recovered.commit_id).toBe(failed.commit_id)
    expect(recovered.status).toBe('completed')
    expect((await client.query('SELECT title FROM pages WHERE draft_id=$1 AND page_id=$2 AND locale=$3', [c.draftId, homeId, 'en'])).rows[0].title).toBe('Recovered collaboration contribution')
    expect((await client.query('SELECT status FROM site_drafts WHERE draft_id=$1', [c.draftId])).rows[0].status).toBe('active')
    expect((await client.query('SELECT pending_operation FROM site_drafts WHERE draft_id=$1', [c.draftId])).rows[0].pending_operation).toBeNull()
    expect((await client.query('SELECT count(*) FROM publish_records WHERE request_key=$1', [recoveryKey])).rows[0].count).toBe('1')
  } finally {
    client.release(); await database.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); await fs.rm(root, { recursive: true, force: true })
  }
}, 300000)

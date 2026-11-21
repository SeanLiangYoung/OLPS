import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { withCmsContentSite } from './test-support/cms-content-fixture.js'
import { CmsPublicationService, createCmsPublicationSchema } from './cms-publication.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

it('等待网站发布锁期间撤销权限，拒绝发布并保持网站版本', async () => {
  await withCmsContentSite(async (context, client) => {
    const siteId = String((await client.query('SELECT site_id FROM site_drafts WHERE draft_id=$1', [context.draftId])).rows[0].site_id)
    await createCmsPublicationSchema(client)
    const service = new CmsPublicationService(context.database, path.dirname(context.workspace.getState().workspacePath), requireRemoteServiceConfig())
    const blocker = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [`publish:${siteId}`])
    const pending = service.publish(context.userId, siteId, context.draftId, randomUUID())
    try {
      await expect.poll(async () => Number((await context.database.query('SELECT count(*) FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [blocker])).rows[0].count), { timeout: 10000 }).toBeGreaterThan(0)
      await client.query('DELETE FROM site_owners WHERE site_id=$1 AND user_id=$2', [siteId, context.userId])
    } finally { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`publish:${siteId}`]) }
    await expect(pending).rejects.toThrow('FORBIDDEN')
    expect((await client.query('SELECT count(*) FROM publish_records WHERE site_id=$1', [siteId])).rows[0].count).toBe('0')
    expect((await client.query('SELECT status,published_commit_id FROM sites WHERE site_id=$1', [siteId])).rows).toEqual([{ status: 'unpublished', published_commit_id: null }])
  })
}, 60000)

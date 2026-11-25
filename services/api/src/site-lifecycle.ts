import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { pool } from './db.js'
import { ensureKnowledgeProjectForSite } from './knowledge-service-client.js'

export type NewSiteInput = { userId: string; name: string; draftName?: string; settings: unknown; sandboxId: string; initialize?: (siteId: string) => Promise<string> }

export async function createUnpublishedSite(input: NewSiteInput, database: pg.Pool = pool): Promise<{ siteId: string; draftId: string; knowledgeBaseId: string }> {
  const client = await database.connect()
  const siteId = randomUUID()
  const draftId = randomUUID()
  const knowledgeBaseId = randomUUID()
  try {
    await client.query('BEGIN')
    await client.query(`INSERT INTO sites(site_id,name,settings,status,created_at,updated_at) VALUES($1,$2,$3,'unpublished',NOW(),NOW())`, [siteId,input.name,input.settings])
    await client.query('INSERT INTO site_owners(site_id,user_id,created_at) VALUES($1,$2,NOW())', [siteId,input.userId])
    await client.query(`INSERT INTO site_drafts(draft_id,site_id,name,sandbox_id,status,init_status,sync_status,created_at,updated_at) VALUES($1,$2,$3,$4,'active','initializing','clean',NOW(),NOW())`, [draftId,siteId,input.draftName ?? input.name,input.sandboxId])
    await client.query('INSERT INTO draft_owners(draft_id,user_id,created_at) VALUES($1,$2,NOW())', [draftId,input.userId])
    await client.query('INSERT INTO knowledge_bases(kb_id,site_id,owner_user_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,NOW(),NOW())', [knowledgeBaseId,siteId,input.userId,input.name])
    if (input.initialize) {
      const head = await input.initialize(siteId)
      await client.query("UPDATE site_drafts SET init_status='ready',base_commit_id=$1,head_commit_id=$1 WHERE draft_id=$2",[head,draftId])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  try {
    await ensureKnowledgeProjectForSite(siteId)
  } catch (error) {
    await revertUnpublishedSiteAfterKnowledgeFailure(siteId, database)
    throw error
  }
  return { siteId, draftId, knowledgeBaseId }
}

async function revertUnpublishedSiteAfterKnowledgeFailure(siteId: string, database: pg.Pool): Promise<void> {
  const client = await database.connect()
  try {
    await client.query('DELETE FROM sites WHERE site_id=$1', [siteId])
  } finally {
    client.release()
  }
}

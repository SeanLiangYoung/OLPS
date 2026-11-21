import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type pg from 'pg'
import { SyncWorkspace } from '@olps/sync'
import { pool } from './db.js'
import { appConfig } from './config.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { siteBuildConfig } from './site-build-config.js'
import { withDraftLock } from './draft-lock.js'
import { refreshContentIndexes } from './content-sandbox.js'

const execute = promisify(execFile)

export async function createCmsDraft(userId: string, siteId: string, name: string, database: pg.Pool = pool, sandboxRoot = appConfig.sandboxRoot) {
  const draftId = randomUUID()
  const sandboxId = randomUUID()
  const root = path.join(sandboxRoot, sandboxId)
  const client=await database.connect()
  let site:pg.QueryResultRow
  try {
    await client.query('BEGIN')
    site=(await client.query('SELECT s.* FROM sites s JOIN site_owners o USING(site_id) WHERE site_id=$1 AND user_id=$2 FOR UPDATE OF s',[siteId,userId])).rows[0]
    if(!site)throw new Error('FORBIDDEN')
    await client.query("INSERT INTO site_drafts(draft_id,site_id,name,sandbox_id,status,init_status,sync_status,created_at,updated_at) VALUES($1,$2,$3,$4,'active','initializing','clean',NOW(),NOW())", [draftId, siteId, name, sandboxId])
    await client.query('INSERT INTO draft_owners(draft_id,user_id,created_at) VALUES($1,$2,NOW())', [draftId, userId])
    await client.query('COMMIT')
  } catch(error) { await client.query('ROLLBACK');throw error } finally { client.release() }
  try {
    let workspace: SyncWorkspace
    let sourceDraftId:string|undefined
    if (site.remote_site_id && site.published_commit_id) {
      workspace = await SyncWorkspace.create({ sandboxRoot, draftId: sandboxId, remote: requireRemoteServiceConfig(), remoteSiteId: site.remote_site_id, baseCommitId: site.published_commit_id, build: siteBuildConfig({draftId,database}) })
    } else {
      const source = (await database.query("SELECT d.* FROM site_drafts d JOIN draft_owners o USING(draft_id) WHERE site_id=$1 AND user_id=$2 AND init_status='ready' ORDER BY d.created_at LIMIT 1", [siteId, userId])).rows[0]
      if (!source) throw new Error('DRAFT_NOT_READY')
      sourceDraftId=source.draft_id
      if (!/^[a-f\d-]{36}$/i.test(source.sandbox_id)) throw new Error('网站目录标识无效')
      workspace = await withDraftLock(source.draft_id, async () => {
        await fs.mkdir(sandboxRoot, { recursive: true })
        await execute('git', ['clone', '--no-hardlinks', '--', path.join(sandboxRoot, source.sandbox_id), root])
        await execute('git', ['remote', 'remove', 'origin'], { cwd: root })
        return SyncWorkspace.open({ sandboxRoot, draftId: sandboxId, remote: requireRemoteServiceConfig(), build: siteBuildConfig({draftId,database}) })
      })
    }
    await refreshContentIndexes({ workspace, database, draftId, userId })
    const state = workspace.getState()
    const completion=await database.connect()
    try{
      await completion.query('BEGIN')
      if(!(await completion.query('SELECT 1 FROM site_owners WHERE site_id=$1 AND user_id=$2',[siteId,userId])).rowCount)throw new Error('FORBIDDEN')
      if(sourceDraftId)await completion.query('INSERT INTO plugin_secrets(draft_id,site_id,plugin_id,ciphertext) SELECT $1,site_id,plugin_id,ciphertext FROM plugin_secrets WHERE draft_id=$2 AND site_id=$3',[draftId,sourceDraftId,siteId])
      else await completion.query('INSERT INTO plugin_secrets(draft_id,site_id,plugin_id,ciphertext) SELECT $1,p.site_id,p.plugin_id,p.ciphertext FROM publication_plugin_secrets p JOIN publish_records r USING(record_id) WHERE p.site_id=$2 AND p.record_id=$3 AND r.commit_id=$4',[draftId,siteId,site.published_record_id,site.published_commit_id])
      await completion.query("UPDATE site_drafts SET init_status='ready',base_commit_id=$1,head_commit_id=$2,remote_site_id=$3 WHERE draft_id=$4",[state.baseCommitId,state.headCommitId,state.remoteSiteId,draftId])
      await completion.query('COMMIT')
    }catch(error){await completion.query('ROLLBACK');throw error}finally{completion.release()}
    return { draftId, siteId, name, initStatus: 'ready', syncStatus: 'clean' }
  } catch (error) {
    await database.query("UPDATE site_drafts SET init_status='failed',last_error=$1 WHERE draft_id=$2", [error instanceof Error ? error.message : String(error), draftId])
    throw error
  }
}

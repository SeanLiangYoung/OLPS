import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { createDefaultSiteContent } from '@olps/domain'
import { pool } from './db.js'
import { appConfig } from './config.js'
import { migrateCmsSchema } from './cms-schema.js'
import { bootstrapCmsSite } from './cms-site-bootstrap.js'
import { createUnpublishedSite } from './site-lifecycle.js'
import { SyncWorkspace } from '@olps/sync'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { refreshContentIndexes } from './content-sandbox.js'
import { createAdvisoryLockClient } from './advisory-lock-client.js'

export async function createCmsSite(userId: string, name: string, database: pg.Pool = pool, sandboxRoot: string = appConfig.sandboxRoot, draftName?: string) {
  const client = await database.connect()
  try { await migrateCmsSchema(client) } finally { client.release() }
  const sandboxId = randomUUID()
  const root = path.join(sandboxRoot,sandboxId)
  try {
    return await createUnpublishedSite({userId,name,draftName,settings:createDefaultSiteContent().settings,sandboxId},database)
  } catch (error) {
    await fs.rm(root,{recursive:true,force:true})
    throw error
  }
}

export async function initializeCmsSite(userId: string, siteId: string, database: pg.Pool = pool, sandboxRoot: string = appConfig.sandboxRoot, publicApiBaseUrl: string = appConfig.publicApiBaseUrl) {
  const result = await database.query("SELECT d.* FROM site_drafts d JOIN site_owners o USING(site_id) WHERE site_id=$1 AND o.user_id=$2 ORDER BY d.created_at LIMIT 1",[siteId,userId])
  if (!result.rowCount) throw new Error('NOT_FOUND')
  const draft = result.rows[0]
  if (!/^[a-f0-9-]{36}$/.test(draft.sandbox_id)) throw new Error('网站目录标识无效')
  if (draft.init_status==='ready') return {initStatus:'ready'}
  const root = path.join(sandboxRoot,draft.sandbox_id)
  const client = await createAdvisoryLockClient(database)
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))',[draft.draft_id])
    const current = await client.query('SELECT init_status FROM site_drafts WHERE draft_id=$1',[draft.draft_id])
    if (current.rows[0].init_status==='ready') return {initStatus:'ready'}
    await client.query("UPDATE site_drafts SET init_status='initializing',last_error=NULL WHERE draft_id=$1",[draft.draft_id])
    try {
      await fs.rm(root,{recursive:true,force:true})
      const site = await client.query('SELECT name FROM sites WHERE site_id=$1',[siteId])
      const head = await bootstrapCmsSite(root,siteId,publicApiBaseUrl,site.rows[0].name)
      const settings = JSON.parse(await fs.readFile(path.join(root,'source/site-settings.json'),'utf8'))
      await client.query('UPDATE sites SET settings=$1,updated_at=NOW() WHERE site_id=$2',[settings,siteId])
      const workspace = await SyncWorkspace.open({sandboxRoot,draftId:draft.sandbox_id,remote:requireRemoteServiceConfig(),baseCommitId:head,headCommitId:head})
      await refreshContentIndexes({workspace,database,draftId:draft.draft_id,userId})
      await client.query("UPDATE site_drafts SET init_status='ready',base_commit_id=$1,head_commit_id=$1,last_error=NULL WHERE draft_id=$2",[head,draft.draft_id])
      return {initStatus:'ready'}
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await client.query("UPDATE site_drafts SET init_status='failed',last_error=$1 WHERE draft_id=$2",[message,draft.draft_id])
      return {initStatus:'failed',error:message}
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(hashtext($1))',[draft.draft_id]) }
    finally { await client.end() }
  }
}

export async function copySiteKnowledgeDocument(userId: string, sourceSiteId: string, documentId: string, targetSiteIds: string[], database: pg.Pool = pool) {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const source = await client.query('SELECT d.* FROM knowledge_documents d JOIN knowledge_bases k USING(kb_id) JOIN site_owners o ON o.site_id=k.site_id AND o.user_id=$1 WHERE k.site_id=$2 AND d.doc_id=$3',[userId,sourceSiteId,documentId])
    if (!source.rowCount) throw new Error('NOT_FOUND')
    const copies: Array<{siteId:string;documentId:string}> = []
    for (const siteId of [...new Set(targetSiteIds)]) {
      const target = await client.query('SELECT k.kb_id FROM knowledge_bases k JOIN site_owners o USING(site_id) WHERE k.site_id=$1 AND o.user_id=$2',[siteId,userId])
      if (!target.rowCount) throw new Error('FORBIDDEN')
      const id = randomUUID()
      await client.query('INSERT INTO knowledge_documents(doc_id,kb_id,title,content,source_document_id,created_at) VALUES($1,$2,$3,$4,$5,NOW())',[id,target.rows[0].kb_id,source.rows[0].title,source.rows[0].content,documentId])
      copies.push({siteId,documentId:id})
    }
    await client.query('COMMIT')
    return copies
  } catch (error) { await client.query('ROLLBACK'); throw error } finally {client.release()}
}

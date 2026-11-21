import { createRequire } from 'node:module'
import type pg from 'pg'
import type { SyncBuildConfig } from '@olps/sync'
import { z } from 'zod'
import { decryptCredential } from './credentials.js'

export async function readDraftPluginSecrets(context:{draftId:string;database:pg.Pool}):Promise<Record<string,Record<string,string>>>{
  const rows=await context.database.query('SELECT d.site_id AS draft_site_id,p.site_id,p.plugin_id,p.ciphertext FROM site_drafts d LEFT JOIN plugin_secrets p USING(draft_id) WHERE d.draft_id=$1',[context.draftId])
  if(!rows.rowCount)throw new Error('NOT_FOUND')
  const secrets:Record<string,Record<string,string>>={}
  for(const row of rows.rows){
    if(!row.plugin_id)continue
    if(row.site_id!==row.draft_site_id)throw new Error('插件密钥的网站范围无效')
    secrets[row.plugin_id]=z.record(z.string(),z.string()).parse(JSON.parse(decryptCredential(row.ciphertext,`${row.site_id}/${row.plugin_id}`)))
  }
  return secrets
}
export function siteBuildConfig(context?:{draftId:string;database:pg.Pool}):SyncBuildConfig {
  return { buildCommand: [process.execPath, createRequire(import.meta.url).resolve('@olps/site-builder/cli')],...(context?{buildEnvironment:async()=>({OLPS_BUILD_PLUGIN_SECRETS:JSON.stringify(await readDraftPluginSecrets(context))})}:{}) }
}

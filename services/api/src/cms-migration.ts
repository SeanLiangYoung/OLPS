import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID,createHash } from 'node:crypto'
import type pg from 'pg'
import { SyncWorkspace } from '@olps/sync'
import { loadWorkspace,verifySite } from '@olps/site-builder'
import { convertLegacyContent } from './content-conversion.js'
import { refreshContentIndexes } from './content-sandbox.js'
import { appConfig } from './config.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { siteBuildConfig } from './site-build-config.js'
import { execFileSync } from 'node:child_process'
import { z } from 'zod'

const countedTables=['users','sites','site_drafts','inquiries','reports','jobs'] as const
export async function cmsBusinessCounts(database:pg.Pool):Promise<Record<string,number>>{
  const result:Record<string,number>={}
  for(const table of countedTables)result[table]=Number((await database.query(`SELECT count(*) FROM ${table}`)).rows[0].count)
  return result
}
async function migrateKnowledge(database:pg.Pool,assignments:Record<string,string[]>):Promise<void>{
  const client=await database.connect()
  try{
    await client.query('BEGIN')
    await client.query('CREATE TABLE IF NOT EXISTS cms_knowledge_migrations(kb_id TEXT PRIMARY KEY,targets JSONB NOT NULL)')
    const sources=await client.query('SELECT * FROM knowledge_bases WHERE site_id IS NULL ORDER BY kb_id FOR UPDATE')
    for(const source of sources.rows){
      const documents=await client.query('SELECT * FROM knowledge_documents WHERE kb_id=$1 ORDER BY doc_id',[source.kb_id])
      if(!documents.rowCount)continue
      const completed=await client.query('SELECT targets FROM cms_knowledge_migrations WHERE kb_id=$1',[source.kb_id])
      if(completed.rowCount)throw new Error('已完成的旧知识库出现新增资料，请检查迁移来源')
      const owned=(await client.query('SELECT site_id FROM site_owners WHERE user_id=$1 ORDER BY site_id',[source.owner_user_id])).rows.map(row=>String(row.site_id))
      const targets=[...new Set(assignments[source.kb_id]??(owned.length===1?owned:[]))]
      if(!targets.length || targets.some(siteId=>!owned.includes(siteId)))throw new Error(`旧知识库需要指定所属网站：${source.kb_id}，请配置 MIGRATION_KB_SITES`)
      for(const grant of (await client.query('SELECT user_id FROM knowledge_base_grants WHERE kb_id=$1',[source.kb_id])).rows){
        for(const siteId of targets)if(!(await client.query('SELECT 1 FROM site_owners WHERE site_id=$1 AND user_id=$2',[siteId,grant.user_id])).rowCount)throw new Error('旧资料的共享成员尚未加入目标网站，请确认访问权限')
      }
      for(let index=0;index<targets.length;index++){
        const target=(await client.query('SELECT kb_id FROM knowledge_bases WHERE site_id=$1',[targets[index]])).rows[0]
        if(!target)throw new Error('目标网站知识库不存在')
        for(const document of documents.rows){
          if(index===0)await client.query('UPDATE knowledge_documents SET kb_id=$1 WHERE doc_id=$2',[target.kb_id,document.doc_id])
          else await client.query('INSERT INTO knowledge_documents(doc_id,kb_id,title,content,source_document_id,created_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),target.kb_id,document.title,document.content,document.doc_id,document.created_at])
        }
      }
      await client.query('INSERT INTO cms_knowledge_migrations(kb_id,targets) VALUES($1,$2)',[source.kb_id,JSON.stringify(targets)])
    }
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function migrateCmsSandboxes(database:pg.Pool,options:{sandboxRoot?:string;publicApiBaseUrl?:string;validationRoot?:string;knowledgeAssignments?:Record<string,string[]>}={}):Promise<void>{
  const sandboxRoot=options.sandboxRoot??appConfig.sandboxRoot
  const validationRoot=options.validationRoot??path.join(appConfig.root,'.intermediate/validation')
  const assignments=z.record(z.string(),z.array(z.string().uuid()).min(1)).parse(options.knowledgeAssignments??JSON.parse(process.env.MIGRATION_KB_SITES??'{}'))
  const before=await cmsBusinessCounts(database)
  const lock=await database.connect()
  const converted:Array<{draftId:string;pageCount:number;head:string}>=[]
  try{
    await lock.query("SELECT pg_advisory_lock(hashtext('olps-cms-sandbox-migration'))")
    const drafts=await lock.query('SELECT d.*,s.name AS site_name,MIN(o.user_id) AS owner_id FROM site_drafts d JOIN sites s USING(site_id) LEFT JOIN draft_owners o USING(draft_id) GROUP BY d.draft_id,s.name ORDER BY d.draft_id')
    for(const draft of drafts.rows){
      if(!z.string().uuid().safeParse(draft.sandbox_id).success)throw new Error('旧网站目录标识需要人工检查')
      const root=path.join(sandboxRoot,draft.sandbox_id)
      const status=await fs.lstat(root).catch(error=>{if(error.code==='ENOENT')return null;throw error})
      if(!status){if(draft.init_status!=='ready')continue;throw new Error('网站编辑目录不存在，迁移已经终止')}
      if(status.isSymbolicLink())throw new Error('网站编辑目录不允许符号链接')
      const pages=await fs.readdir(path.join(root,'source/pages'),{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT' && draft.init_status!=='ready')return [];throw error})
      const hasFlat=pages.some(file=>file.isFile() && file.name.endsWith('.json'))
      const recovery=await fs.stat(path.join(root,'.olps-cache/content-conversion-recovery.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error})
      const legacyRecovery=await fs.stat(path.join(root,'.olps-cache/legacy-credentials.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error})
      const marker=await fs.stat(path.join(root,'source/.cms-content.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error})
      const pendingIndex=marker && execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==draft.head_commit_id
      if(!hasFlat && !recovery && !legacyRecovery && !pendingIndex)continue
      if(!draft.owner_id)throw new Error('旧草稿缺少成员，迁移已经终止')
      const result=await convertLegacyContent(root,{siteId:draft.site_id,siteName:draft.site_name,publicApiBaseUrl:options.publicApiBaseUrl??appConfig.publicApiBaseUrl,userId:draft.owner_id,credentials:{database,draftId:draft.draft_id}})
      await verifySite(root)
      const workspace=await SyncWorkspace.open({sandboxRoot,draftId:draft.sandbox_id,remote:requireRemoteServiceConfig(),baseCommitId:draft.base_commit_id,headCommitId:result.headCommitId,build:siteBuildConfig({draftId:draft.draft_id,database})})
      await refreshContentIndexes({workspace,database,draftId:draft.draft_id,userId:draft.owner_id})
      await lock.query("UPDATE site_drafts SET head_commit_id=$1,init_status='ready',status='active',sync_status='dirty',last_error=NULL WHERE draft_id=$2",[result.headCommitId,draft.draft_id])
      const settings=(await loadWorkspace(root)).model.settings
      await lock.query('UPDATE sites SET settings=$1 WHERE site_id=$2 AND NOT(settings ? $3)',[settings,draft.site_id,'schemaVersion'])
      converted.push({draftId:draft.draft_id,pageCount:result.convertedPageCount,head:result.headCommitId})
    }
    await migrateKnowledge(database,assignments)
    const integrations=await database.query('SELECT i.*,s.status FROM site_integrations i JOIN sites s USING(site_id)')
    for(const integration of integrations.rows){
      const published=integration.status==='published'
      const scopeKey=published?`site:${integration.site_id}`:`draft:${integration.draft_id}`
      for(const [connector,id,connected] of [['googleAds',integration.ads_account_id,integration.ads_connected],['ga4',integration.ga_property_id,integration.ga_connected]] as const){
        if(!id && !connected)continue
        await database.query("INSERT INTO integration_connections(scope_key,site_id,draft_id,connector,status,account_id,account_config,last_error) VALUES($1,$2,$3,$4,'needs_reconnect',$5,$6,$7) ON CONFLICT(scope_key,connector) DO NOTHING",[scopeKey,integration.site_id,published?null:integration.draft_id,connector,id||null,JSON.stringify({legacyConnected:connected,legacyAccountId:id}), '请重新授权并确认营销账户，迁移资料未包含 OAuth 凭据与追踪标识'])
      }
    }
    const after=await cmsBusinessCounts(database)
    for(const table of countedTables)if(before[table]!==after[table])throw new Error(`迁移前后业务记录数量不一致：${table}`)
    if(converted.length){
      await fs.mkdir(validationRoot,{recursive:true})
      const digest=createHash('sha256').update(JSON.stringify(converted)).digest('hex').slice(0,16)
      await fs.writeFile(path.join(validationRoot,`cms-migration-${digest}.json`),JSON.stringify({before,after,converted},null,2))
    }
  }finally{await lock.query("SELECT pg_advisory_unlock(hashtext('olps-cms-sandbox-migration'))");lock.release()}
}

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash,randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type pg from 'pg'
import { lookup } from 'mime-types'
import { SyncWorkspace,type SyncRemoteConfig } from '@olps/sync'
import { loadWorkspace,classifyAssetsOnly,buildAssetsOnly } from '@olps/site-builder'
import { pool } from './db.js'
import { appConfig } from './config.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { siteBuildConfig } from './site-build-config.js'
import { encryptCredential,decryptCredential,createCredentialSchema } from './credentials.js'
import { connectDeployTarget,validateDeployConfig,type DeployType } from './deploy-targets/adapters.js'
import { recordPublishedContentSnapshot,readPublishedContentSnapshot } from './cms-public.js'
import { withDraftLock } from './draft-lock.js'
import { isDeepStrictEqual } from 'node:util'
import { promoteIntegrationScope } from './integration-routes.js'
import { createIntegrationSchema } from './integration-schema.js'
import { refreshContentIndexes,refreshContentIndexesUnlocked } from './content-sandbox.js'
import { createAdvisoryLockClient } from './advisory-lock-client.js'

type PublishedArtifact={path:string;sha256:string;size:number}
export class PublicationBuildError extends Error{
  constructor(readonly validationLog:string){super('网站内容未通过发布检查')}
}
export async function createCmsPublicationSchema(client:pg.PoolClient):Promise<void>{
  await createCredentialSchema(client)
  await createIntegrationSchema(client)
  await client.query('CREATE TABLE IF NOT EXISTS deploy_targets(target_id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,name TEXT NOT NULL,type TEXT NOT NULL,enabled BOOLEAN NOT NULL,config_ciphertext TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
  await client.query('CREATE TABLE IF NOT EXISTS deploy_target_files(target_id TEXT NOT NULL REFERENCES deploy_targets(target_id) ON DELETE CASCADE,path TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(target_id,path))')
  await client.query("CREATE TABLE IF NOT EXISTS publish_records(record_id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(user_id),request_key TEXT NOT NULL,status TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'full',remote_site_id TEXT,commit_id TEXT,public_url TEXT,error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(site_id,request_key))")
  await client.query('ALTER TABLE publish_records ADD COLUMN IF NOT EXISTS base_commit_id TEXT')
  await client.query('ALTER TABLE publish_records ADD COLUMN IF NOT EXISTS candidate_commit_id TEXT')
  await client.query('ALTER TABLE sites ADD COLUMN IF NOT EXISTS published_record_id TEXT REFERENCES publish_records(record_id) ON DELETE SET NULL')
  await client.query('CREATE TABLE IF NOT EXISTS publication_plugin_secrets(record_id TEXT NOT NULL REFERENCES publish_records(record_id) ON DELETE CASCADE,site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,plugin_id TEXT NOT NULL,ciphertext TEXT NOT NULL,PRIMARY KEY(record_id,plugin_id))')
  await client.query('ALTER TABLE site_drafts ADD COLUMN IF NOT EXISTS pending_publication_key TEXT')
  await client.query('CREATE TABLE IF NOT EXISTS publish_target_results(record_id TEXT NOT NULL REFERENCES publish_records(record_id) ON DELETE CASCADE,target_id TEXT NOT NULL REFERENCES deploy_targets(target_id) ON DELETE CASCADE,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,uploaded INTEGER NOT NULL DEFAULT 0,removed INTEGER NOT NULL DEFAULT 0,error TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(record_id,target_id))')
  await client.query('CREATE TABLE IF NOT EXISTS publish_notifications(record_id TEXT NOT NULL REFERENCES publish_records(record_id) ON DELETE CASCADE,provider TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,error TEXT,PRIMARY KEY(record_id,provider))')
}
function safePath(value:string):void{
  if(!value || value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.split('/').some(part=>!part || part==='.' || part==='..')) throw new Error('发布路径无效')
}
function humanQuestion(question:string,names:Map<string,string>):string{
  return question.replace(/source\/pages\/([a-f\d-]+)\/[^\s/]+\.json/gi,(_match,id:string)=>names.get(id)??'相关页面')
    .replace(/source\/[\w\-./]+\.json/g,'相关内容').replace(/[a-f\d]{8}-[a-f\d-]{27,}/gi,'相关内容')
    .replace(/\bid\s*=\s*[`"']?[\w-]+[`"']?/g,'相关区块').replace(/\bprops\.text\b/g,'区块文字').replace(/\bblocks\b/g,'内容区块')
    .replace(/\bours\b/g,'当前编辑内容').replace(/\btheirs\b/g,'协作更新').replace(/\bbase\b/g,'共同原文').replace(/\bMERGE_HEAD\b|\bHEAD\b/g,'协作版本')
}
export class CmsPublicationService{
  constructor(readonly database:pg.Pool=pool,readonly sandboxRoot:string=appConfig.sandboxRoot,readonly remote:SyncRemoteConfig=requireRemoteServiceConfig(),readonly notifySearchConsole?: (siteId:string,publicUrl:string,database:pg.Pool)=>Promise<unknown>){}
  private async member(userId:string,siteId:string):Promise<void>{
    if(!(await this.database.query('SELECT 1 FROM site_owners WHERE site_id=$1 AND user_id=$2',[siteId,userId])).rowCount) throw new Error('FORBIDDEN')
  }
  private async remoteRequest(remoteSiteId:string,suffix:string,commitId:string):Promise<Response>{
    const url=`${this.remote.baseUrl}/api/remote/sites/${encodeURIComponent(remoteSiteId)}/${suffix}${suffix.includes('?')?'&':'?'}commitId=${encodeURIComponent(commitId)}`
    const response=await fetch(url,{headers:{Authorization:`Bearer ${this.remote.token}`},signal:AbortSignal.timeout(60000)})
    if(!response.ok) throw new Error(`REMOTE_${response.status}: ${await response.text()}`)
    return response
  }
  async saveTarget(userId:string,siteId:string,input:{targetId?:string;name:string;type:DeployType;enabled:boolean;config:unknown}):Promise<string>{
    await this.member(userId,siteId)
    const targetId=input.targetId??randomUUID()
    const client=await this.database.connect()
    try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`deploy:${targetId}`])
    if(!(await client.query('SELECT 1 FROM site_owners WHERE site_id=$1 AND user_id=$2',[siteId,userId])).rowCount)throw new Error('FORBIDDEN')
    const previous=await client.query('SELECT * FROM deploy_targets WHERE target_id=$1',[targetId])
    if(previous.rowCount && previous.rows[0].site_id!==siteId) throw new Error('FORBIDDEN')
    if(previous.rowCount && previous.rows[0].type!==input.type) throw new Error('发布目标类型不能变更，请创建新目标')
    if(!input.config || typeof input.config!=='object' || Array.isArray(input.config))throw new Error('发布目标配置无效')
    const supplied=input.config as Record<string,unknown>
    const config=previous.rowCount?{...JSON.parse(decryptCredential(previous.rows[0].config_ciphertext,`${siteId}/deploy/${targetId}`)),...supplied}:supplied
    validateDeployConfig(input.type,config)
    if(previous.rowCount){
      const oldConfig=JSON.parse(decryptCredential(previous.rows[0].config_ciphertext,`${siteId}/deploy/${targetId}`)) as Record<string,unknown>
      const newConfig=config as Record<string,unknown>
      const locationKeys=['host','port','username','root','bucket','region','endpoint','prefix']
      if(!isDeepStrictEqual(locationKeys.map(key=>oldConfig[key]),locationKeys.map(key=>newConfig[key]))) await client.query('DELETE FROM deploy_target_files WHERE target_id=$1',[targetId])
    }
    const encrypted=encryptCredential(JSON.stringify(config),`${siteId}/deploy/${targetId}`)
    await client.query('INSERT INTO deploy_targets(target_id,site_id,name,type,enabled,config_ciphertext) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(target_id) DO UPDATE SET name=EXCLUDED.name,enabled=EXCLUDED.enabled,config_ciphertext=EXCLUDED.config_ciphertext,updated_at=NOW()',[targetId,siteId,input.name,input.type,input.enabled,encrypted])
    await client.query('COMMIT')
    return targetId
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  async listTargets(userId:string,siteId:string,options:{limit?:number;cursor?:{name:string;targetId:string}}={}){await this.member(userId,siteId);return(await this.database.query('SELECT target_id AS "targetId",name,type,enabled FROM deploy_targets WHERE site_id=$1 AND ($3::text IS NULL OR (name,target_id)>($3::text,$4::text)) ORDER BY name,target_id LIMIT $2',[siteId,options.limit??100,options.cursor?.name??null,options.cursor?.targetId??null])).rows}
  async deleteTarget(userId:string,siteId:string,targetId:string):Promise<void>{
    await this.member(userId,siteId)
    const result=await this.database.query('DELETE FROM deploy_targets WHERE site_id=$1 AND target_id=$2 RETURNING target_id',[siteId,targetId])
    if(!result.rowCount)throw new Error('NOT_FOUND')
  }
  async testTarget(userId:string,siteId:string,targetId:string):Promise<{connected:boolean;error?:string}>{
    await this.member(userId,siteId)
    const row=(await this.database.query('SELECT * FROM deploy_targets WHERE site_id=$1 AND target_id=$2',[siteId,targetId])).rows[0]
    if(!row)throw new Error('NOT_FOUND')
    const config=JSON.parse(decryptCredential(row.config_ciphertext,`${siteId}/deploy/${targetId}`)) as Record<string,unknown>
    let adapter:Awaited<ReturnType<typeof connectDeployTarget>>|undefined
    try{adapter=await connectDeployTarget(row.type,config);await adapter.test();return{connected:true}}
    catch(error){let message=error instanceof Error?error.message:String(error);for(const key of ['password','privateKey','secretAccessKey','accessKeyId','sessionToken'])if(typeof config[key]==='string' && config[key])message=message.replaceAll(config[key] as string,'[已隐藏]');return{connected:false,error:message}}
    finally{if(adapter)await adapter.close()}
  }
  async siteFiles(userId:string,siteId:string,file?:string):Promise<Response>{
    await this.member(userId,siteId)
    const site=(await this.database.query("SELECT * FROM sites WHERE site_id=$1 AND status='published'",[siteId])).rows[0]
    if(!site?.published_commit_id)throw new Error('NOT_FOUND')
    if(file!==undefined){safePath(file);return this.remoteRequest(site.remote_site_id,`files/public/${file.split('/').map(encodeURIComponent).join('/')}`,site.published_commit_id)}
    const manifest=await(await this.remoteRequest(site.remote_site_id,'artifacts',site.published_commit_id)).json() as {files:PublishedArtifact[]}
    return Response.json({files:manifest.files.filter(entry=>entry.path.startsWith('public/')).map(entry=>({...entry,path:entry.path.slice(7)}))})
  }
  async synchronizationState(userId:string,siteId:string,draftId:string){
    await this.member(userId,siteId)
    const row=(await this.database.query('SELECT d.sync_status,d.conflict_summary FROM site_drafts d JOIN draft_owners o USING(draft_id) WHERE d.site_id=$1 AND d.draft_id=$2 AND o.user_id=$3',[siteId,draftId,userId])).rows[0]
    if(!row)throw new Error('NOT_FOUND')
    const titles=(await this.database.query('SELECT page_id,title FROM pages WHERE draft_id=$1',[draftId])).rows
    let question=row.conflict_summary as string|null
    if(question){
      const names=new Map<string,string>(titles.map(item=>[item.page_id,item.title]))
      question=humanQuestion(question,names)
    }
    return{syncStatus:row.sync_status,question}
  }
  async records(userId:string,siteId:string,options:{limit?:number;cursor?:{createdAt:string;recordId:string}}={}){await this.member(userId,siteId);return(await this.database.query("SELECT r.*,COALESCE((SELECT jsonb_agg(t) FROM publish_target_results t WHERE t.record_id=r.record_id),'[]') AS targets,COALESCE((SELECT jsonb_agg(n) FROM publish_notifications n WHERE n.record_id=r.record_id),'[]') AS notifications FROM publish_records r WHERE site_id=$1 AND ($3::timestamptz IS NULL OR (r.created_at,r.record_id)<($3::timestamptz,$4::text)) ORDER BY created_at DESC,record_id DESC LIMIT $2",[siteId,options.limit??100,options.cursor?.createdAt??null,options.cursor?.recordId??null])).rows}
  async record(userId:string,siteId:string,recordId:string){
    await this.member(userId,siteId)
    const result=await this.database.query("SELECT r.*,COALESCE((SELECT jsonb_agg(t) FROM publish_target_results t WHERE t.record_id=r.record_id),'[]') AS targets,COALESCE((SELECT jsonb_agg(n) FROM publish_notifications n WHERE n.record_id=r.record_id),'[]') AS notifications FROM publish_records r WHERE r.site_id=$1 AND r.record_id=$2",[siteId,recordId])
    if(!result.rowCount)throw new Error('NOT_FOUND')
    return result.rows[0]
  }
  async downloadZip(userId:string,siteId:string,recordId:string):Promise<Response>{
    await this.member(userId,siteId)
    const record=(await this.database.query('SELECT * FROM publish_records WHERE record_id=$1 AND site_id=$2',[recordId,siteId])).rows[0]
    if(!record?.commit_id) throw new Error('NOT_FOUND')
    return this.remoteRequest(record.remote_site_id,'download.zip',record.commit_id)
  }
  private async runTarget(record:Record<string,any>,target:Record<string,any>,userId:string):Promise<boolean>{
    const lock=await this.database.connect()
    let adapter:Awaited<ReturnType<typeof connectDeployTarget>>|undefined
    let uploaded=0,removed=0
    const secrets:string[]=[]
    let authorized=false
    try{
      await lock.query('SELECT pg_advisory_lock(hashtext($1))',[`deploy:${target.target_id}`])
      if(!(await lock.query('SELECT 1 FROM site_owners WHERE site_id=$1 AND user_id=$2',[record.site_id,userId])).rowCount)throw new Error('FORBIDDEN')
      authorized=true
      const latest=(await lock.query('SELECT * FROM deploy_targets WHERE target_id=$1 AND site_id=$2',[target.target_id,record.site_id])).rows[0]
      if(!latest?.enabled)return false
      target=latest
      const current=await lock.query('SELECT published_commit_id FROM sites WHERE site_id=$1',[record.site_id])
      if(current.rows[0]?.published_commit_id!==record.commit_id)throw new Error('历史发布只能下载，不能覆盖当前目标')
      await lock.query("INSERT INTO publish_target_results(record_id,target_id,status,attempts) VALUES($1,$2,'running',1) ON CONFLICT(record_id,target_id) DO UPDATE SET status='running',attempts=publish_target_results.attempts+1,error=NULL",[record.record_id,target.target_id])
      const manifest=await(await this.remoteRequest(record.remote_site_id,'artifacts',record.commit_id)).json() as {files:PublishedArtifact[]}
      const files=manifest.files.filter(file=>file.path.startsWith('public/'))
      const expected=new Map<string,PublishedArtifact>()
      for(const file of files){safePath(file.path);if(!/^[a-f\d]{64}$/.test(file.sha256))throw new Error('发布摘要无效');expected.set(file.path.slice(7),file)}
      const previous=await lock.query('SELECT path,sha256 FROM deploy_target_files WHERE target_id=$1',[target.target_id])
      const old=new Map<string,string>(previous.rows.map(row=>[row.path,row.sha256]))
      const upload=[...expected.entries()].filter(([file,metadata])=>old.get(file)!==metadata.sha256)
      const remove=[...old.keys()].filter(file=>!expected.has(file))
      if(upload.length || remove.length){
        const config=JSON.parse(decryptCredential(target.config_ciphertext,`${record.site_id}/deploy/${target.target_id}`))
        for(const key of ['password','privateKey','secretAccessKey','accessKeyId','sessionToken'])if(typeof config[key]==='string' && config[key])secrets.push(config[key])
        adapter=await connectDeployTarget(target.type,config)
        for(const [file,metadata]of upload){
          const bytes=Buffer.from(await(await this.remoteRequest(record.remote_site_id,`files/${metadata.path.split('/').map(encodeURIComponent).join('/')}`,record.commit_id)).arrayBuffer())
          if(createHash('sha256').update(bytes).digest('hex')!==metadata.sha256)throw new Error(`发布文件摘要不符：${file}`)
          await adapter.upload(file,bytes,{contentType:lookup(file)||'application/octet-stream',cacheControl:/\.[a-f\d]{10,}\./.test(file)?'public,max-age=31536000,immutable':'no-cache'})
          await lock.query('INSERT INTO deploy_target_files(target_id,path,sha256) VALUES($1,$2,$3) ON CONFLICT(target_id,path) DO UPDATE SET sha256=EXCLUDED.sha256',[target.target_id,file,metadata.sha256]);uploaded++
        }
        for(const file of remove){safePath(file);await adapter.remove(file);await lock.query('DELETE FROM deploy_target_files WHERE target_id=$1 AND path=$2',[target.target_id,file]);removed++}
      }
      await lock.query("UPDATE publish_target_results SET status='completed',uploaded=$1,removed=$2,updated_at=NOW() WHERE record_id=$3 AND target_id=$4",[uploaded,removed,record.record_id,target.target_id])
    }catch(error){
      if(!authorized)throw error
      let message=error instanceof Error?error.message:String(error)
      for(const secret of secrets)message=message.replaceAll(secret,'[已隐藏]').replaceAll(encodeURIComponent(secret),'[已隐藏]')
      await lock.query("UPDATE publish_target_results SET status='failed',uploaded=$1,removed=$2,error=$3,updated_at=NOW() WHERE record_id=$4 AND target_id=$5",[uploaded,removed,message,record.record_id,target.target_id])
    }finally{try{if(adapter)await adapter.close()}finally{await lock.query('SELECT pg_advisory_unlock(hashtext($1))',[`deploy:${target.target_id}`]);lock.release()}}
    return true
  }
  async retryNotification(userId:string,siteId:string,recordId:string,provider:'indexnow'|'search_console'){
    await this.member(userId,siteId)
    const record=(await this.database.query('SELECT r.* FROM publish_records r JOIN sites s ON s.site_id=r.site_id AND s.published_commit_id=r.commit_id WHERE r.record_id=$1 AND r.site_id=$2',[recordId,siteId])).rows[0]
    if(!record)throw new Error('NOT_FOUND')
    await this.notify(record,provider)
    return(await this.database.query('SELECT * FROM publish_notifications WHERE record_id=$1 AND provider=$2',[recordId,provider])).rows[0]
  }
  private async notify(record:Record<string,any>,provider:'indexnow'|'search_console'):Promise<void>{
    const model=await readPublishedContentSnapshot(record.site_id,this.database)
    const base=model.publishConfig.publicSiteUrl.replace(/\/$/,'')+'/'
    let unavailable:string|undefined
    if(provider==='search_console' && !this.notifySearchConsole)unavailable='缺少真实 Search Console 授权服务'
    if(provider==='indexnow' && process.env.INDEXNOW_ENABLED!=='true')unavailable='未启用 INDEXNOW_ENABLED 真实通知'
    const url=new URL(base)
    if(provider==='indexnow' && (url.protocol!=='https:' || ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))unavailable='IndexNow 需要公开可验证的 HTTPS 网站'
    if(unavailable){await this.database.query("INSERT INTO publish_notifications(record_id,provider,status,error) VALUES($1,$2,'blocked',$3) ON CONFLICT(record_id,provider) DO UPDATE SET status='blocked',error=EXCLUDED.error",[record.record_id,provider,unavailable]);return}
    await this.database.query("INSERT INTO publish_notifications(record_id,provider,status,attempts) VALUES($1,$2,'running',1) ON CONFLICT(record_id,provider) DO UPDATE SET status='running',attempts=publish_notifications.attempts+1,error=NULL",[record.record_id,provider])
    try{
      if(provider==='search_console')await this.notifySearchConsole!(record.site_id,base,this.database)
      else{
        const key=model.publishConfig.indexNowKey
        if(!key)throw new Error('IndexNow 网站密钥未配置')
        const keyLocation=new URL(`${key}.txt`,base).href
        const verification=await fetch(keyLocation,{signal:AbortSignal.timeout(20000)})
        if(!verification.ok || (await verification.text()).trim()!==key)throw new Error('IndexNow 网站密钥文件尚未通过公开验证')
        const manifest=await(await this.remoteRequest(record.remote_site_id,'artifacts',record.commit_id)).json() as {files:PublishedArtifact[]}
        const urls=manifest.files.filter(file=>file.path.startsWith('public/') && file.path.endsWith('index.html')).map(file=>new URL(file.path.slice(7).replace(/index\.html$/,''),base).href)
        for(let index=0;index<urls.length;index+=10000){
          const response=await fetch('https://api.indexnow.org/indexnow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:url.hostname,key,keyLocation,urlList:urls.slice(index,index+10000)}),signal:AbortSignal.timeout(30000)})
          if(!response.ok)throw new Error(`IndexNow HTTP ${response.status}`)
        }
      }
      await this.database.query("UPDATE publish_notifications SET status='completed',error=NULL WHERE record_id=$1 AND provider=$2",[record.record_id,provider])
    }catch(error){
      const message=error instanceof Error?error.message:String(error)
      const blocked=message==='NOT_CONNECTED' || (error instanceof Error && error.name==='ConnectorConfigurationError')
      await this.database.query('UPDATE publish_notifications SET status=$1,error=$2 WHERE record_id=$3 AND provider=$4',[blocked?'blocked':'failed',message,record.record_id,provider])
    }
  }
  async retryTarget(userId:string,siteId:string,recordId:string,targetId:string){
    await this.member(userId,siteId)
    const record=(await this.database.query('SELECT * FROM publish_records WHERE site_id=$1 AND record_id=$2',[siteId,recordId])).rows[0]
    const target=(await this.database.query('SELECT * FROM deploy_targets WHERE site_id=$1 AND target_id=$2 AND enabled=TRUE',[siteId,targetId])).rows[0]
    if(!record?.commit_id || !target) throw new Error('NOT_FOUND')
    const latest=await this.database.query("SELECT record_id FROM publish_records WHERE site_id=$1 AND commit_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",[siteId])
    if(latest.rows[0]?.record_id!==recordId)throw new Error('历史发布只能下载，不能覆盖当前目标')
    if(!await this.runTarget(record,target,userId))throw new Error('NOT_FOUND')
    return(await this.database.query('SELECT * FROM publish_target_results WHERE record_id=$1 AND target_id=$2',[recordId,targetId])).rows[0]
  }
  async pull(userId:string,siteId:string,draftId:string){return this.synchronize(userId,siteId,draftId)}
  async continue(userId:string,siteId:string,draftId:string,answer:string){return this.synchronize(userId,siteId,draftId,answer)}
  private async synchronize(userId:string,siteId:string,draftId:string,answer?:string){
    await this.member(userId,siteId)
    const completed=await withDraftLock(draftId,async()=>{
      await this.member(userId,siteId)
      const row=(await this.database.query('SELECT d.*,s.remote_site_id AS site_remote_id,s.published_commit_id AS site_published_commit_id FROM site_drafts d JOIN sites s USING(site_id) JOIN draft_owners o ON o.draft_id=d.draft_id AND o.user_id=$1 WHERE d.draft_id=$2 AND d.site_id=$3',[userId,draftId,siteId])).rows[0]
      if(!row || row.init_status!=='ready' || row.status==='archived')throw new Error('DRAFT_NOT_READY')
      if(!row.site_published_commit_id)throw new Error('DRAFT_NOT_READY')
      if(answer!==undefined && !['merge_conflict','awaiting_user'].includes(row.sync_status))throw new Error('没有待确认的内容')
      const workspace=await SyncWorkspace.open({sandboxRoot:this.sandboxRoot,draftId:row.sandbox_id,remote:this.remote,remoteSiteId:row.remote_site_id??row.site_remote_id,baseCommitId:row.base_commit_id,headCommitId:row.head_commit_id,build:siteBuildConfig({draftId,database:this.database})})
      await this.database.query("UPDATE site_drafts SET status='syncing',pending_operation=$1 WHERE draft_id=$2",[row.pending_operation??'pull',draftId])
      try{
        if(answer!==undefined)await workspace.continueAfterUser({userMessage:answer})
        else{
          const pulled=await workspace.pull()
          if(pulled.status==='merge_conflict')await workspace.resolveConflictsWithAgent()
        }
        const state=workspace.getState()
        const conflict=['merge_conflict','awaiting_user'].includes(state.status)
        const failed=state.status==='validation_failed'
        await this.database.query('UPDATE site_drafts SET status=$1,sync_status=$2,remote_site_id=$3,base_commit_id=$4,head_commit_id=$5,conflict_summary=$6,pending_operation=$7,last_error=$8 WHERE draft_id=$9',[conflict?'conflict':failed?'error':'active',state.status,state.remoteSiteId,state.baseCommitId,state.headCommitId,state.conflictSummary??null,conflict?(row.pending_operation??'pull'):null,failed?state.validationLog:null,draftId])
        return{workspace,state,pendingKey:row.pending_operation==='push'?row.pending_publication_key as string|null:null,question:state.conflictSummary??null}
      }catch(error){
        const state=workspace.getState()
        await this.database.query("UPDATE site_drafts SET status='error',sync_status=$1,remote_site_id=$2,base_commit_id=$3,head_commit_id=$4,last_error=$5 WHERE draft_id=$6",[state.status,state.remoteSiteId,state.baseCommitId,state.headCommitId,error instanceof Error?error.message:String(error),draftId])
        throw error
      }
    })
    if(['clean','dirty'].includes(completed.state.status)){
      try{await refreshContentIndexes({workspace:completed.workspace,database:this.database,draftId,userId})}catch(error){await this.database.query("UPDATE site_drafts SET status='error',last_error=$1 WHERE draft_id=$2",[error instanceof Error?error.message:String(error),draftId]);throw error}
      if(completed.pendingKey){
        await this.database.query('UPDATE publish_records SET base_commit_id=(SELECT published_commit_id FROM sites WHERE site_id=$1),candidate_commit_id=NULL WHERE site_id=$1 AND request_key=$2 AND commit_id IS NULL',[siteId,completed.pendingKey])
        const record=await this.publish(userId,siteId,draftId,completed.pendingKey)
        await this.database.query('UPDATE site_drafts SET pending_publication_key=NULL WHERE draft_id=$1',[draftId])
        return{syncStatus:'clean',question:null,record}
      }
    }
    let question=completed.question
    if(question){
      const titles=(await this.database.query('SELECT page_id,title FROM pages WHERE draft_id=$1',[draftId])).rows
      const titleMap=new Map<string,string>(titles.map(row=>[row.page_id,row.title]))
      question=question.replace(/source\/pages\/([a-f\d-]+)\/[^\s/]+\.json/gi,(_match,id:string)=>titleMap.get(id)??'相关页面')
      question=question.replace(/source\/[^\s]+\.json/g,'相关内容')
      for(const row of titles)question=question.replaceAll(row.page_id,row.title)
      question=humanQuestion(question,new Map(titles.map(item=>[item.page_id,item.title])))
    }
    return{syncStatus:completed.state.status,question}
  }
  async publish(userId:string,siteId:string,draftId:string,requestKey:string){
    return withDraftLock(draftId,()=>this.publishLocked(userId,siteId,draftId,requestKey))
  }
  private async publishLocked(userId:string,siteId:string,draftId:string,requestKey:string){
    await this.member(userId,siteId)
    const lock=await createAdvisoryLockClient(this.database)
    const recordId=randomUUID()
    let baseline:string|undefined
    let record:Record<string,any>|undefined
    try{
      await lock.query('SELECT pg_advisory_lock(hashtext($1))',[`publish:${siteId}`])
      if(!(await lock.query('SELECT 1 FROM site_owners WHERE site_id=$1 AND user_id=$2',[siteId,userId])).rowCount)throw new Error('FORBIDDEN')
      const duplicate=await lock.query('SELECT * FROM publish_records WHERE site_id=$1 AND request_key=$2',[siteId,requestKey])
      if(duplicate.rowCount && duplicate.rows[0].status==='completed')return duplicate.rows[0]
      const row=(await lock.query('SELECT d.*,s.published_commit_id,s.remote_site_id AS site_remote_id FROM site_drafts d JOIN sites s USING(site_id) JOIN draft_owners o ON o.draft_id=d.draft_id AND o.user_id=$1 WHERE d.draft_id=$2 AND d.site_id=$3',[userId,draftId,siteId])).rows[0]
      if(!row || row.init_status!=='ready' || row.status==='archived')throw new Error('DRAFT_NOT_READY')
      if(duplicate.rowCount)record=duplicate.rows[0]
      else{await lock.query("INSERT INTO publish_records(record_id,site_id,draft_id,user_id,request_key,status,base_commit_id) VALUES($1,$2,$3,$4,$5,'running',$6)",[recordId,siteId,draftId,userId,requestKey,row.published_commit_id]);record=(await lock.query('SELECT * FROM publish_records WHERE record_id=$1',[recordId])).rows[0]}
      await lock.query("UPDATE site_drafts SET status='syncing',pending_operation='push',pending_publication_key=$1,last_error=NULL WHERE draft_id=$2",[requestKey,draftId])
      if(!record!.commit_id && record!.candidate_commit_id && record!.remote_site_id){
        const response=await fetch(`${this.remote.baseUrl}/api/remote/sites/${encodeURIComponent(record!.remote_site_id)}`,{headers:{Authorization:`Bearer ${this.remote.token}`},signal:AbortSignal.timeout(20000)})
        if(!response.ok)throw new Error(`REMOTE_${response.status}`)
        const hosted=await response.json() as {publishedCommitId:string|null;publicUrl:string}
        if(hosted.publishedCommitId===record!.candidate_commit_id){
          const workspace=await SyncWorkspace.open({sandboxRoot:this.sandboxRoot,draftId:row.sandbox_id,remote:this.remote,build:siteBuildConfig({draftId,database:this.database})})
          const recovered=await workspace.recoverPublishedPush({remoteSiteId:record!.remote_site_id,publishedCommitId:record!.candidate_commit_id})
          await lock.query('UPDATE site_drafts SET remote_site_id=$1,base_commit_id=$2,head_commit_id=$3,sync_status=$4 WHERE draft_id=$5',[recovered.remoteSiteId,recovered.baseCommitId,recovered.headCommitId,recovered.status,draftId])
          await lock.query('UPDATE publish_records SET commit_id=candidate_commit_id,public_url=$1 WHERE record_id=$2',[hosted.publicUrl,record!.record_id])
          record=(await lock.query('SELECT * FROM publish_records WHERE record_id=$1',[record!.record_id])).rows[0]
        }
      }
      if(!record!.commit_id){
        const workspacePath=path.join(this.sandboxRoot,row.sandbox_id)
        let kind:'full'|'assets_only'='full'
        const preparer=await SyncWorkspace.open({sandboxRoot:this.sandboxRoot,draftId:row.sandbox_id,remote:this.remote,remoteSiteId:row.remote_site_id??row.site_remote_id,baseCommitId:row.base_commit_id,build:siteBuildConfig({draftId,database:this.database})})
        const hosting=await preparer.prepareRemoteSite()
        await lock.query('UPDATE site_drafts SET remote_site_id=$1 WHERE draft_id=$2',[hosting.remoteSiteId,draftId])
        await lock.query('UPDATE publish_records SET remote_site_id=$1 WHERE record_id=$2',[hosting.remoteSiteId,record!.record_id])
        const settingsFile=path.join(workspacePath,'source/site-settings.json')
        const configFile=path.join(workspacePath,'source/publish-config.json')
        const settings=JSON.parse(await fs.readFile(settingsFile,'utf8'))
        const config=JSON.parse(await fs.readFile(configFile,'utf8'))
        if(!settings.siteUrl || settings.siteUrl===`${String(config.publicApiBaseUrl).replace(/\/$/,'')}/p/${siteId}`)settings.siteUrl=hosting.publicUrl
        config.publicSiteUrl=settings.siteUrl
        const pathname=new URL(config.publicSiteUrl).pathname
        config.hostingBasePath=pathname.endsWith('/')?pathname:`${pathname}/`
        await fs.writeFile(settingsFile,`${JSON.stringify(settings,null,2)}\n`)
        await fs.writeFile(configFile,`${JSON.stringify(config,null,2)}\n`)
        if(row.published_commit_id && row.base_commit_id===row.published_commit_id){
          const known=execFileSync('git',['cat-file','-t',row.published_commit_id],{cwd:workspacePath,encoding:'utf8'}).trim()
          if(known!=='commit')throw new Error('已发布版本类型无效')
          const parent=path.join(path.dirname(this.sandboxRoot),'publication-baselines');await fs.mkdir(parent,{recursive:true})
          baseline=await fs.mkdtemp(path.join(parent,'version-'))
          const names=execFileSync('git',['ls-tree','-rz','--name-only',row.published_commit_id],{cwd:workspacePath,encoding:'utf8'}).split('\0').filter(Boolean)
          for(const file of names){safePath(file);const target=path.join(baseline,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,execFileSync('git',['show',`${row.published_commit_id}:${file}`],{cwd:workspacePath,maxBuffer:128*1024*1024}))}
          if((await classifyAssetsOnly(baseline,workspacePath)).kind==='assets_only'){await buildAssetsOnly(baseline,workspacePath);kind='assets_only'}
        }
        const workspace=await SyncWorkspace.open({sandboxRoot:this.sandboxRoot,draftId:row.sandbox_id,remote:this.remote,remoteSiteId:row.remote_site_id??row.site_remote_id,baseCommitId:row.base_commit_id,headCommitId:row.head_commit_id,build:kind==='assets_only'?{buildCommand:[process.execPath,'tools/site-verify.mjs']}:siteBuildConfig({draftId,database:this.database}),onPushPrepared:async candidate=>{
          await lock.query('BEGIN')
          try{
            await lock.query('DELETE FROM publication_plugin_secrets WHERE record_id=$1',[record!.record_id])
            await lock.query('INSERT INTO publication_plugin_secrets(record_id,site_id,plugin_id,ciphertext) SELECT $1,site_id,plugin_id,ciphertext FROM plugin_secrets WHERE draft_id=$2 AND site_id=$3',[record!.record_id,draftId,siteId])
            await lock.query('UPDATE publish_records SET candidate_commit_id=$1,remote_site_id=$2,kind=$3 WHERE record_id=$4',[candidate.headCommitId,candidate.remoteSiteId,kind,record!.record_id])
            await lock.query('UPDATE site_drafts SET remote_site_id=$1,head_commit_id=$2 WHERE draft_id=$3',[candidate.remoteSiteId,candidate.headCommitId,draftId])
            await lock.query('COMMIT')
          }catch(error){await lock.query('ROLLBACK');throw error}
        }})
        let result=await workspace.push({expectedPublishedCommitId:row.published_commit_id??null})
        if(result.status==='merge_conflict'){
          const resolved=await workspace.resolveConflictsWithAgent()
          if(['clean','dirty'].includes(resolved.status))result=await workspace.push({expectedPublishedCommitId:resolved.baseCommitId})
        }
        const state=workspace.getState()
        await lock.query('UPDATE site_drafts SET remote_site_id=$1,base_commit_id=$2,head_commit_id=$3,sync_status=$4 WHERE draft_id=$5',[state.remoteSiteId,state.baseCommitId,state.headCommitId,state.status,draftId])
        if(result.error || result.status!=='clean'){
          if(result.status==='validation_failed')throw new PublicationBuildError(result.error??state.validationLog??'网站内容验证未完成')
          if(['merge_conflict','awaiting_user'].includes(result.status)){
            const resolved=workspace.getState()
            await lock.query("UPDATE site_drafts SET status='conflict',sync_status=$1,conflict_summary=$2,pending_operation='push',pending_publication_key=$3,head_commit_id=$4 WHERE draft_id=$5",[resolved.status,resolved.conflictSummary??null,requestKey,resolved.headCommitId,draftId])
          }
          throw new Error(result.error??`PUBLISH_${result.status}`)
        }
        await lock.query('UPDATE publish_records SET remote_site_id=$1,commit_id=$2,public_url=$3,kind=$4 WHERE record_id=$5',[result.remoteSiteId,result.publishedCommitId,result.publicUrl,kind,record!.record_id])
        record=(await lock.query('SELECT * FROM publish_records WHERE record_id=$1',[record!.record_id])).rows[0]
      }
      if(row.published_commit_id!==record!.base_commit_id && row.published_commit_id!==record!.commit_id) throw new Error('PUBLISHED_VERSION_CHANGED')
      const synchronizedWorkspace=await SyncWorkspace.open({sandboxRoot:this.sandboxRoot,draftId:row.sandbox_id,remote:this.remote,build:siteBuildConfig({draftId,database:this.database})})
      await refreshContentIndexesUnlocked({workspace:synchronizedWorkspace,database:this.database,draftId,userId})
      await lock.query("UPDATE site_drafts SET status='active',last_error=NULL,pending_operation=NULL,pending_publication_key=NULL WHERE draft_id=$1",[draftId])
      const snapshotParent=path.join(path.dirname(this.sandboxRoot),'publication-snapshots');await fs.mkdir(snapshotParent,{recursive:true})
      const snapshot=await fs.mkdtemp(path.join(snapshotParent,'commit-'))
      try{
        const workspacePath=path.join(this.sandboxRoot,row.sandbox_id)
        const names=execFileSync('git',['ls-tree','-rz','--name-only',record!.commit_id],{cwd:workspacePath,encoding:'utf8'}).split('\0').filter(Boolean)
        for(const file of names){safePath(file);const target=path.join(snapshot,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,execFileSync('git',['show',`${record!.commit_id}:${file}`],{cwd:workspacePath,maxBuffer:128*1024*1024}))}
        const published=(await loadWorkspace(snapshot)).model
        await recordPublishedContentSnapshot(siteId,record!.commit_id,published,this.database)
        await lock.query('UPDATE sites SET settings=$1 WHERE site_id=$2',[published.settings,siteId])
      }finally{await fs.rm(snapshot,{recursive:true,force:true})}
      await lock.query('BEGIN')
      try{
        await lock.query("UPDATE sites SET status='published',remote_site_id=$1,published_commit_id=$2,public_url=$3,published_record_id=$5,updated_at=NOW() WHERE site_id=$4",[record!.remote_site_id,record!.commit_id,record!.public_url,siteId,record!.record_id])
        await lock.query('COMMIT')
      }catch(error){await lock.query('ROLLBACK');throw error}
      await promoteIntegrationScope(draftId,siteId,this.database)
      for(const target of (await lock.query('SELECT * FROM deploy_targets WHERE site_id=$1 AND enabled=TRUE ORDER BY target_id',[siteId])).rows)await this.runTarget(record!,target,userId)
      await lock.query("UPDATE publish_records SET status='completed',error=NULL,updated_at=NOW() WHERE record_id=$1",[record!.record_id])
      for(const provider of ['indexnow','search_console'] as const)await this.notify(record!,provider)
      return(await lock.query('SELECT * FROM publish_records WHERE record_id=$1',[record!.record_id])).rows[0]
    }catch(error){if(record){await lock.query("UPDATE publish_records SET status='failed',error=$1,updated_at=NOW() WHERE record_id=$2",[error instanceof Error?error.message:String(error),record.record_id]);await lock.query("UPDATE site_drafts SET status=CASE WHEN status='conflict' THEN status ELSE 'error' END,last_error=$1 WHERE draft_id=$2",[error instanceof Error?error.message:String(error),draftId])}throw error}
    finally{try{if(baseline)await fs.rm(baseline,{recursive:true,force:true})}finally{try{await lock.query('SELECT pg_advisory_unlock(hashtext($1))',[`publish:${siteId}`])}finally{await lock.end()}}}
  }
}

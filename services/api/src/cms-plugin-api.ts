import fs from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import type pg from 'pg'
import {Hono} from 'hono'
import {bodyLimit} from 'hono/body-limit'
import {z} from 'zod'
import {assertValidSchema} from '@olps/domain'
import {loadWorkspace} from '@olps/site-builder'
import {runPluginApi,type PluginApiRequest,type PluginPermissions} from '@olps/plugin-runtime'
import {pool} from './db.js'
import {appConfig} from './config.js'
import {createInquiry} from './cms-public.js'
import {resolvePluginSettings,type PluginSettingDefinition,type SiteModel} from '@olps/render'
import {decryptCredential} from './credentials.js'
import {readDraftPluginSecrets} from './site-build-config.js'

type PreviewResolver={resolve(token:string):Promise<Record<string,unknown>>}
type Manifest={id:string;settings:PluginSettingDefinition[];server:{api?:string};permissions:PluginPermissions}
const execute=promisify(execFile)
const requestHeaders=new Set(['accept','accept-language','content-type','idempotency-key'])
const responseHeaders=new Set(['content-type','content-language','retry-after'])
const maxBody=64000

export async function createCmsPluginApiSchema(database:Pick<pg.Pool,'query'>):Promise<void>{
  await database.query("CREATE TABLE IF NOT EXISTS plugin_store(site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,plugin_id TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('public','preview')),draft_scope TEXT NOT NULL,key TEXT NOT NULL,value JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(site_id,plugin_id,source,draft_scope,key))")
  await database.query("ALTER TABLE plugin_logs ADD COLUMN IF NOT EXISTS site_id TEXT REFERENCES sites(site_id) ON DELETE CASCADE,ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'preview'")
}
async function safeFile(root:string,relative:string):Promise<string>{
  const absolute=path.resolve(root,relative)
  if(!absolute.startsWith(path.resolve(root)+path.sep))throw new Error('PLUGIN_PATH_INVALID')
  let current=path.resolve(root)
  for(const part of ['',...path.relative(root,absolute).split(path.sep)]){
    current=path.join(current,part)
    if((await fs.lstat(current)).isSymbolicLink())throw new Error('PLUGIN_PATH_INVALID')
  }
  return absolute
}
async function gitFile(root:string,commit:string,relative:string):Promise<string>{
  const {stdout:mode}=await execute('git',['ls-tree','--format=%(objectmode)',commit,'--',relative],{cwd:root})
  if(!['100644','100755'].includes(mode.trim()))throw new Error('PLUGIN_VERSION_UNAVAILABLE')
  return(await execute('git',['show',`${commit}:${relative}`],{cwd:root,maxBuffer:1024*1024})).stdout
}
function scrub(value:unknown,secrets:Record<string,string>):unknown{
  if(typeof value==='string'){let text=value;for(const secret of Object.values(secrets))if(secret)text=text.replaceAll(secret,'[已隐藏]');return text}
  if(Array.isArray(value))return value.map(item=>scrub(item,secrets))
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[String(scrub(key,secrets)),scrub(item,secrets)]))
  return value
}
async function limitedText(response:Response,maximum:number):Promise<string>{
  if(!response.body)return ''
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum)throw new Error('PLUGIN_RESPONSE_TOO_LARGE');chunks.push(value)}}finally{await reader.cancel();reader.releaseLock()}
  return Buffer.concat(chunks).toString('utf8')
}
export function createCmsPluginApiRoutes(previews:PreviewResolver,database:pg.Pool=pool,sandboxRoot=appConfig.sandboxRoot):Hono{
  const routes=new Hono()
  const paths=['/public/:siteId/plugins/:pluginId/*','/preview-access/:token/plugins/:pluginId/*']
  for(const routePath of paths){
    routes.use(routePath,bodyLimit({maxSize:maxBody,onError:c=>c.json({error:'提交内容超过大小限制',code:'VALIDATION_FAILED'},400)}))
    routes.all(routePath,async c=>{
      let secrets:Record<string,string>={},logs:Promise<unknown>[]=[]
      try{
        const pluginId=z.string().regex(/^[a-z][a-z0-9-]*$/).max(100).parse(c.req.param('pluginId'))
        const source=routePath.startsWith('/public/')?'public':'preview'
        let siteId:string,draftId:string,root:string,read:(relative:string)=>Promise<string>,model
        if(source==='public'){
          siteId=z.string().uuid().parse(c.req.param('siteId'))
          const row=(await database.query("SELECT s.published_commit_id,s.published_record_id,r.draft_id,d.sandbox_id,p.model,k.ciphertext FROM sites s JOIN publish_records r ON r.record_id=s.published_record_id AND r.site_id=s.site_id AND r.commit_id=s.published_commit_id JOIN site_drafts d ON d.draft_id=r.draft_id JOIN cms_public_snapshots p ON p.site_id=s.site_id AND p.commit_id=s.published_commit_id LEFT JOIN publication_plugin_secrets k ON k.record_id=s.published_record_id AND k.site_id=s.site_id AND k.plugin_id=$2 WHERE s.site_id=$1 AND s.status='published'",[siteId,pluginId])).rows[0]
          if(!row)throw new Error('NOT_FOUND')
          draftId=row.draft_id;root=path.join(sandboxRoot,z.string().uuid().parse(row.sandbox_id));await safeFile(sandboxRoot,`${row.sandbox_id}/.git`)
          model=row.model as SiteModel
          read=relative=>gitFile(root,row.published_commit_id,relative)
          if(row.ciphertext)secrets=z.record(z.string(),z.string()).parse(JSON.parse(decryptCredential(row.ciphertext,`${siteId}/${pluginId}`)))
        }else{
          const capability=await previews.resolve(c.req.param('token')!)
          draftId=String(capability.draft_id)
          const row=(await database.query('SELECT d.site_id,d.sandbox_id FROM site_drafts d JOIN site_owners o ON o.site_id=d.site_id AND o.user_id=$2 JOIN draft_owners own ON own.draft_id=d.draft_id AND own.user_id=o.user_id WHERE d.draft_id=$1',[draftId,capability.user_id])).rows[0]
          if(!row)throw new Error('PREVIEW_FORBIDDEN')
          siteId=row.site_id;root=path.join(sandboxRoot,z.string().uuid().parse(row.sandbox_id))
          model=(await loadWorkspace(root)).model
          read=async relative=>fs.readFile(await safeFile(root,relative),'utf8')
          secrets=(await readDraftPluginSecrets({draftId,database}))[pluginId]??{}
        }
        const config=model.plugins.plugins[pluginId]
        if(!config?.enabled||!config.permissionsAcceptedAt||!config.permissionsAcceptedBy)throw new Error('NOT_FOUND')
        let manifest:Manifest
        try{const raw=JSON.parse(await read(`plugins/${pluginId}/plugin.json`));assertValidSchema('plugin',raw);manifest=raw as unknown as Manifest}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new Error('NOT_FOUND');throw error}
        if(manifest.id!==pluginId||manifest.server.api!=='server/api.js')throw new Error('NOT_FOUND')
        const scriptSource=await read(`plugins/${pluginId}/server/api.js`)
        const draftScope=source==='public'?'':draftId,scope=[siteId,pluginId,source,draftScope]
        const storeKey=(key:string)=>z.string().min(1).max(200).parse(key)
        const headers:Record<string,string>={};c.req.raw.headers.forEach((value,key)=>{if(requestHeaders.has(key))headers[key]=value})
        const raw=await c.req.text();if(Buffer.byteLength(raw)>maxBody)throw new Error('PLUGIN_BODY_INVALID')
        const pluginPrefix=`/plugins/${pluginId}`,requestPath=decodeURIComponent(c.req.path)
        const request:PluginApiRequest={method:c.req.method,path:requestPath.slice(requestPath.indexOf(pluginPrefix)+pluginPrefix.length)||'/',query:c.req.query(),headers,body:raw?(headers['content-type']?.split(';')[0]?.trim()==='application/json'?JSON.parse(raw):raw):null}
        const result=await runPluginApi({pluginId,scriptSource,permissions:manifest.permissions,settings:{...resolvePluginSettings(manifest.settings,config.settings),...secrets},request,
          store:{get:async key=>(await database.query('SELECT value FROM plugin_store WHERE site_id=$1 AND plugin_id=$2 AND source=$3 AND draft_scope=$4 AND key=$5',[...scope,storeKey(key)])).rows[0]?.value??null,
            set:async(key,value)=>{
              const json=JSON.stringify(value),validatedKey=storeKey(key)
              if(json===undefined||Buffer.byteLength(json)>maxBody)throw new Error('PLUGIN_STORE_VALUE_INVALID')
              const client=await database.connect()
              try{
                await client.query('BEGIN')
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[JSON.stringify(scope)])
                const usage=(await client.query('SELECT count(*) AS count,COALESCE(sum(octet_length(value::text)),0)+octet_length($6::jsonb::text) AS bytes FROM plugin_store WHERE site_id=$1 AND plugin_id=$2 AND source=$3 AND draft_scope=$4 AND key<>$5',[...scope,validatedKey,json])).rows[0]
                if(Number(usage.count)>=1000||Number(usage.bytes)>1024*1024)throw new Error('PLUGIN_STORE_QUOTA')
                await client.query('INSERT INTO plugin_store(site_id,plugin_id,source,draft_scope,key,value) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(site_id,plugin_id,source,draft_scope,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()',[...scope,validatedKey,json])
                await client.query('COMMIT')
              }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
            },
            delete:async key=>{await database.query('DELETE FROM plugin_store WHERE site_id=$1 AND plugin_id=$2 AND source=$3 AND draft_scope=$4 AND key=$5',[...scope,storeKey(key)])}},
          inquiries:{create:payload=>createInquiry({siteId,draftId:source==='preview'?draftId:undefined,source,request:payload,clientKey:(c.env as {incoming?:{socket:{remoteAddress?:string}}}|undefined)?.incoming?.socket.remoteAddress??'unknown'},database,sandboxRoot)},
          log:(level,message,meta)=>{if(logs.length>=100)throw new Error('PLUGIN_LOG_LIMIT');const cleanMeta=JSON.stringify(scrub(meta??null,secrets));if(Buffer.byteLength(cleanMeta)>maxBody)throw new Error('PLUGIN_LOG_TOO_LARGE');logs.push(database.query('INSERT INTO plugin_logs(draft_id,site_id,plugin_id,source,level,message,meta) VALUES($1,$2,$3,$4,$5,$6,$7)',[draftId,siteId,pluginId,source,String(scrub(level,secrets)).slice(0,30),String(scrub(message,secrets)).slice(0,10000),cleanMeta]))},
          fetchImpl:async(url,init)=>{const response=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(4500)});if(response.status>=300&&response.status<400){await response.body?.cancel();throw new Error('PLUGIN_FETCH_REDIRECT_FORBIDDEN')}return{status:response.status,headers:Object.fromEntries(response.headers),body:await limitedText(response,1024*1024)}}})
        await Promise.all(logs);logs=[]
        if(result.status<200||result.status>599||(result.status>=300&&result.status<400)||!Number.isInteger(result.status))throw new Error('PLUGIN_RESPONSE_INVALID')
        const output=new Headers({'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'no-store'})
        for(const [name,value]of Object.entries(result.headers??{})){
          if(!responseHeaders.has(name.toLowerCase())||/[\r\n]/.test(value))throw new Error('PLUGIN_RESPONSE_HEADER_INVALID')
          if(name.toLowerCase()==='content-type'&&!/^(application\/json|text\/plain)(?:\s*;\s*charset=utf-8)?$/i.test(value))throw new Error('PLUGIN_RESPONSE_TYPE_INVALID')
          output.set(name,value)
        }
        const body=output.get('content-type')!.startsWith('text/plain')?String(result.body??''):JSON.stringify(result.body??null)
        if(Buffer.byteLength(body)>1024*1024)throw new Error('PLUGIN_RESPONSE_TOO_LARGE')
        return new Response(result.status===204||result.status===205?null:body,{status:result.status,headers:output})
      }catch(error){
        await Promise.all(logs)
        const message=String(scrub(error instanceof Error?error.message:String(error),secrets))
        if(message==='NOT_FOUND')return c.json({error:'插件接口不存在',code:'NOT_FOUND'},404)
        if(message==='PREVIEW_FORBIDDEN')return c.json({error:'预览访问已失效',code:'FORBIDDEN'},403)
        if(error instanceof z.ZodError||error instanceof SyntaxError||message==='PLUGIN_BODY_INVALID')return c.json({error:'提交内容无效',code:'VALIDATION_FAILED'},400)
        return c.json({error:message,code:'PLUGIN_API_FAILED'},502)
      }
    })
  }
  return routes
}

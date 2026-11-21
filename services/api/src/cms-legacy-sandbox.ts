import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync,spawnSync } from 'node:child_process'
import { appConfig } from './config.js'
import { encryptCredential } from './credentials.js'
import { z } from 'zod'

export type LegacyPageRow={page_id:string;site_id:string;kind:string;slug:string;title:string;status:string;locale:string;seo:unknown;body:unknown;created_at:Date;updated_at:Date;published_at:Date|null}
export function stableDraftIdForLegacySite(legacySiteId:string):string{
  const digest=createHash('sha256').update(`olps:migrate:site:${legacySiteId}`,'utf8').digest('hex')
  return`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`
}
async function rejectSymlinks(root:string):Promise<void>{
  if((await fs.lstat(root)).isSymbolicLink())throw new Error('旧资源包含符号链接')
  for(const entry of await fs.readdir(root,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error('旧资源包含符号链接');if(entry.isDirectory())await rejectSymlinks(path.join(root,entry.name))}
}
async function sourceDigest(root:string):Promise<Record<string,string>>{
  const files:Record<string,string>={}
  const visit=async(directory:string):Promise<void>=>{
    for(const entry of (await fs.readdir(path.join(root,directory),{withFileTypes:true})).sort((left,right)=>left.name.localeCompare(right.name))){
      const file=path.posix.join(directory,entry.name)
      if(file==='.git' || file==='.olps-cache' || file==='.olps/legacy-input.json')continue
      if(entry.isSymbolicLink())throw new Error('旧资源包含符号链接')
      if(entry.isDirectory())await visit(file)
      else if(entry.isFile())files[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')
      else throw new Error('迁移目录包含不支持的文件类型')
    }
  }
  await visit('');return files
}
export async function initializeLegacySiteSandbox(input:{legacySiteId:string;draftId:string;sandboxId:string;pendingSiteId:string;siteName:string;settings:unknown;pages:LegacyPageRow[];skipIfPresent:boolean},sandboxRoot=appConfig.sandboxRoot):Promise<{headCommitId:string;baseCommitId:string|null}>{
  if(!z.string().uuid().safeParse(input.sandboxId).success)throw new Error('迁移目录标识无效')
  for(const row of input.pages)if(!z.string().uuid().safeParse(row.page_id).success)throw new Error(`旧页面标识需要人工检查：${row.page_id}`)
  const root=path.join(sandboxRoot,input.sandboxId)
  const fingerprint=createHash('sha256').update(JSON.stringify({site:input.legacySiteId,settings:input.settings,pages:input.pages})).digest('hex')
  const settings={...input.settings as Record<string,unknown>}
  const mapsApiKey=typeof settings.mapsApiKey==='string'?settings.mapsApiKey:''
  const scope=`legacy/${input.draftId}`
  const encrypted=mapsApiKey?encryptCredential(JSON.stringify({mapsApiKey}),scope):null
  delete settings.mapsApiKey
  const serializedPage=(row:LegacyPageRow)=>({pageId:row.page_id,kind:row.kind,slug:row.slug,title:row.title,status:row.status,locale:row.locale,seo:row.seo,body:row.body,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()})
  const exists=await fs.stat(root).catch(error=>{if(error.code==='ENOENT')return null;throw error})
  if(exists){
    await rejectSymlinks(root)
    const marker=JSON.parse(await fs.readFile(path.join(root,'.olps/legacy-input.json'),'utf8'))
    if(marker.fingerprint!==fingerprint)throw new Error('迁移输入已变化，请检查原始数据与迁移目录')
    const result=spawnSync('git',['rev-parse','--verify','HEAD'],{cwd:root,encoding:'utf8'})
    if(result.status===0){
      if(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw new Error('迁移目录已有未提交修改')
      if(JSON.stringify(marker.files)!==JSON.stringify(await sourceDigest(root)))throw new Error('迁移目录文件与准备结果不一致')
      const actualPages=(await fs.readdir(path.join(root,'source/pages'))).sort()
      const expectedPages=input.pages.map(row=>`${row.page_id}.json`).sort()
      if(JSON.stringify(actualPages)!==JSON.stringify(expectedPages))throw new Error('迁移目录页面与原始数据不一致')
      for(const row of input.pages){
        const actual=JSON.parse(await fs.readFile(path.join(root,'source/pages',`${row.page_id}.json`),'utf8'))
        if(JSON.stringify(actual)!==JSON.stringify(serializedPage(row)))throw new Error('迁移目录页面内容与原始数据不一致')
      }
      const actualSettings=JSON.parse(await fs.readFile(path.join(root,'source/site-settings.json'),'utf8'))
      if(JSON.stringify(actualSettings)!==JSON.stringify(settings))throw new Error('迁移目录设置与原始数据不一致')
      return{headCommitId:result.stdout.trim(),baseCommitId:result.stdout.trim()}
    }
  }
  await fs.mkdir(path.join(root,'source/pages'),{recursive:true})
  await fs.mkdir(path.join(root,'.olps'),{recursive:true})
  execFileSync('git',['init','-b','main'],{cwd:root,stdio:'pipe'})
  await fs.writeFile(path.join(root,'.gitignore'),'.olps-cache/\n')
  await fs.writeFile(path.join(root,'.olps/legacy-input.json'),JSON.stringify({fingerprint}))
  if(encrypted){await fs.mkdir(path.join(root,'.olps-cache'),{recursive:true});await fs.writeFile(path.join(root,'.olps-cache/legacy-credentials.json'),JSON.stringify({draftId:input.draftId,scope,ciphertext:encrypted}),{mode:0o600})}
  await fs.writeFile(path.join(root,'source/site-settings.json'),JSON.stringify(settings))
  for(const row of input.pages){
    await fs.writeFile(path.join(root,'source/pages',`${row.page_id}.json`),JSON.stringify(serializedPage(row)))
  }
  if(/^[\w-]+$/.test(input.legacySiteId)){
    const assets=path.join(sandboxRoot,input.legacySiteId,'assets')
    const stat=await fs.lstat(assets).catch(error=>{if(error.code==='ENOENT')return null;throw error})
    if(stat){await rejectSymlinks(assets);await fs.cp(assets,path.join(root,'assets'),{recursive:true})}
  }
  await fs.writeFile(path.join(root,'.olps/legacy-input.json'),JSON.stringify({fingerprint,files:await sourceDigest(root)}))
  execFileSync('git',['add','-A'],{cwd:root,stdio:'pipe'})
  execFileSync('git',['-c','user.name=OLPS','-c','user.email=olps@localhost','commit','-m','准备网站格式转换'],{cwd:root,stdio:'pipe'})
  const headCommitId=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
  return{headCommitId,baseCommitId:headCommitId}
}

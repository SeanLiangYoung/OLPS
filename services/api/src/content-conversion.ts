import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as parse5 from 'parse5'
import * as cssTree from 'css-tree'
import { parseSrcset, stringifySrcset } from 'srcset'
import { lookup } from 'mime-types'
import sharp from 'sharp'
import { buildSite,verifySite } from '@olps/site-builder'
import { bootstrapCmsSite } from './cms-site-bootstrap.js'
import type pg from 'pg'
import { createCredentialSchema,encryptCredential,decryptCredential } from './credentials.js'
import { z } from 'zod'

type LegacyPage = {pageId:string;slug:string;title:string;locale:string;status:string;body:{html:string};seo?:{title?:string;description?:string};createdAt?:string;updatedAt?:string}
const convertedMarker = 'source/.cms-content.json'
const recoveryFile = '.olps-cache/content-conversion-recovery.json'
const allowedExtensions = new Set(['.png','.jpg','.jpeg','.webp','.gif','.svg','.mp4','.webm','.pdf'])

async function safeFiles(root: string, relative = ''): Promise<string[]> {
  const result: string[] = []
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('不允许符号链接目录')
  for (const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})) {
    const file = path.posix.join(relative,entry.name)
    if (entry.isSymbolicLink()) throw new Error(`不允许符号链接：${file}`)
    if (entry.name==='.git') continue
    if (entry.isDirectory()) result.push(...await safeFiles(root,file))
    else if (entry.isFile()) result.push(file)
  }
  return result
}

function rewriteCss(source: string, resolve: (url:string)=>string, context:'stylesheet'|'declarationList'='stylesheet'): string {
  const tree = cssTree.parse(source,{context})
  let changed = false
  cssTree.walk(tree,node => {
    if (node.type==='Url') {
      const next = resolve(node.value)
      if (next!==node.value) {node.value=next;changed=true}
    }
    if (node.type==='Atrule' && node.name.toLowerCase()==='import' && node.prelude) cssTree.walk(node.prelude,child => {
      if (child.type==='String') {
        const next = resolve(child.value)
        if (next!==child.value) {child.value=next;changed=true}
      }
    })
  })
  return changed ? cssTree.generate(tree) : source
}

function rewriteHtml(source: string, resolve: (url:string)=>string): string {
  const document = parse5.parse(source,{sourceCodeLocationInfo:true})
  const edits: Array<{start:number;end:number;text:string}> = []
  const walk = (node:parse5.DefaultTreeAdapterMap['node']):void => {
    if ('attrs' in node) {
      for (const attribute of node.attrs) {
        let value = attribute.value
        if (['src','href','poster'].includes(attribute.name)) value=resolve(value)
        else if (attribute.name==='srcset') value=stringifySrcset(parseSrcset(value).map(item=>({...item,url:resolve(item.url)})))
        else if (attribute.name==='style') value=rewriteCss(value,resolve,'declarationList')
        if (value!==attribute.value) {
          const location = node.sourceCodeLocation?.attrs?.[attribute.name]
          if (!location) throw new Error('HTML 属性缺少位置')
          edits.push({start:location.startOffset,end:location.endOffset,text:`${attribute.name}="${value.replaceAll('&','&amp;').replaceAll('"','&quot;')}"`})
        }
      }
      if (node.tagName==='style' && node.sourceCodeLocation?.startTag && node.sourceCodeLocation.endTag) {
        const start=node.sourceCodeLocation.startTag.endOffset
        const end=node.sourceCodeLocation.endTag.startOffset
        const value=rewriteCss(source.slice(start,end),resolve)
        if (value!==source.slice(start,end)) edits.push({start,end,text:value})
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child)
    if ('tagName' in node && node.tagName==='template' && 'content' in node) walk(node.content)
  }
  walk(document)
  let result=source
  for (const edit of edits.sort((a,b)=>b.start-a.start)) result=result.slice(0,edit.start)+edit.text+result.slice(edit.end)
  return result
}

export async function convertLegacyContent(root: string, input:{siteId:string;siteName:string;publicApiBaseUrl:string;userId:string;credentials?:{database:pg.Pool;draftId:string}}):Promise<{convertedPageCount:number;headCommitId:string}> {
  const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim()
  const files=await safeFiles(root)
  const legacyRecovery='.olps-cache/legacy-credentials.json'
  if(files.includes(convertedMarker) && files.includes(legacyRecovery) && !files.includes(recoveryFile)){
    if(!input.credentials)throw new Error('恢复地图密钥需要网站加密凭据数据库')
    const record=JSON.parse(await fs.readFile(path.join(root,legacyRecovery),'utf8'))
    if(record.draftId!==input.credentials.draftId || record.scope!==`legacy/${input.credentials.draftId}`)throw new Error('旧凭据恢复记录与草稿不一致')
    const secret=JSON.parse(decryptCredential(record.ciphertext,record.scope))
    if(typeof secret.mapsApiKey!=='string' || !secret.mapsApiKey)throw new Error('旧凭据格式无效')
    const scope=`${input.siteId}/google-maps`
    const journal=await fs.open(path.join(root,recoveryFile),'wx',0o600)
    try{await journal.writeFile(JSON.stringify({siteId:input.siteId,draftId:input.credentials.draftId,scope,ciphertext:encryptCredential(JSON.stringify({apiKey:secret.mapsApiKey}),scope)}));await journal.sync()}finally{await journal.close()}
    files.push(recoveryFile)
  }
  if(files.includes(recoveryFile)) {
    if(!input.credentials) throw new Error('恢复地图密钥需要网站加密凭据数据库')
    const record=JSON.parse(await fs.readFile(path.join(root,recoveryFile),'utf8'))
    if(record.siteId!==input.siteId || record.draftId!==input.credentials.draftId || record.scope!==`${input.siteId}/google-maps` || typeof record.ciphertext!=='string') throw new Error('凭据恢复记录与网站不一致')
    decryptCredential(record.ciphertext,record.scope)
    const client=await input.credentials.database.connect()
    try {
      await client.query('BEGIN')
      await createCredentialSchema(client)
      const ownership=await client.query('SELECT 1 FROM site_drafts d JOIN site_owners o USING(site_id) WHERE d.draft_id=$1 AND d.site_id=$2 AND o.user_id=$3',[input.credentials.draftId,input.siteId,input.userId])
      if(!ownership.rowCount) throw new Error('FORBIDDEN')
      await client.query("INSERT INTO plugin_secrets(draft_id,site_id,plugin_id,ciphertext) VALUES($1,$2,'google-maps',$3) ON CONFLICT(draft_id,plugin_id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=NOW()",[record.draftId,record.siteId,record.ciphertext])
      await client.query('COMMIT')
      await fs.rm(path.join(root,recoveryFile))
      if(files.includes(convertedMarker))await fs.rm(path.join(root,legacyRecovery),{force:true})
    } catch(error) {await client.query('ROLLBACK');throw error} finally {client.release()}
  }
  if (files.includes(convertedMarker)) {
    const marker=JSON.parse(await fs.readFile(path.join(root,convertedMarker),'utf8'))
    return {convertedPageCount:marker.pageIds.length,headCommitId:git(['rev-parse','HEAD'])}
  }
  if (git(['status','--porcelain'])) throw new Error('转换前工作目录必须没有未提交修改')
  const pages:LegacyPage[]=[]
  for (const file of files.filter(file=>/^source\/pages\/[^/]+\.json$/.test(file))) {
    const page=JSON.parse(await fs.readFile(path.join(root,file),'utf8')) as LegacyPage
    if (!z.string().uuid().safeParse(page.pageId).success || typeof page.body?.html!=='string') throw new Error(`旧页面无效：${file}`)
    pages.push(page)
  }
  const parent=path.join(path.dirname(root),'.cms-conversion')
  await fs.mkdir(parent,{recursive:true})
  const staging=await fs.mkdtemp(path.join(parent,'stage-'))
  const backup=await fs.mkdtemp(path.join(parent,'backup-'))
  const managed=['source','assets','themes','plugins','tools','server-config','public','olps.manifest.json','.gitignore','.olps-build.json']
  const moved:string[]=[]
  let secretClient:pg.PoolClient|undefined
  let mapsApiKey:string|undefined
  let gitCommitted=false
  try {
    const encryptedLegacy=files.includes('.olps-cache/legacy-credentials.json')?JSON.parse(await fs.readFile(path.join(root,'.olps-cache/legacy-credentials.json'),'utf8')):null
    if(encryptedLegacy){
      if(!input.credentials || encryptedLegacy.draftId!==input.credentials.draftId || encryptedLegacy.scope!==`legacy/${input.credentials.draftId}`)throw new Error('旧凭据恢复需要对应的网站数据库')
      const legacySecret=JSON.parse(decryptCredential(encryptedLegacy.ciphertext,encryptedLegacy.scope))
      if(typeof legacySecret.mapsApiKey!=='string')throw new Error('旧凭据格式无效')
      mapsApiKey=legacySecret.mapsApiKey
    }
    await bootstrapCmsSite(staging,input.siteId,input.publicApiBaseUrl,input.siteName)
    const write=async(file:string,value:unknown)=>{
      await fs.mkdir(path.dirname(path.join(staging,file)),{recursive:true})
      await fs.writeFile(path.join(staging,file),`${JSON.stringify(value,null,2)}\n`)
    }
    const now=new Date().toISOString()
    if (files.includes('source/site-settings.json')) {
      const old=JSON.parse(await fs.readFile(path.join(root,'source/site-settings.json'),'utf8'))
      if (typeof old.mapsApiKey==='string' && old.mapsApiKey) {
        if (!input.credentials) throw new Error('地图密钥转换需要网站加密凭据数据库')
        mapsApiKey=old.mapsApiKey
      }
      const settings=JSON.parse(await fs.readFile(path.join(staging,'source/site-settings.json'),'utf8'))
      if (old.defaultLocale) settings.defaultLocale=Intl.getCanonicalLocales(old.defaultLocale)[0]
      await write('source/site-settings.json',settings)
      const plugins=JSON.parse(await fs.readFile(path.join(staging,'source/plugins.json'),'utf8'))
      if (typeof old.mapsEnabled==='boolean') plugins.plugins['google-maps'].enabled=old.mapsEnabled
      if (typeof old.whatsappEnabled==='boolean') plugins.plugins.whatsapp.enabled=old.whatsappEnabled
      if (typeof old.whatsappNumber==='string') plugins.plugins.whatsapp.settings.phone=old.whatsappNumber
      if (typeof old.whatsappLabel==='string') plugins.plugins.whatsapp.settings.buttonLabel={en:old.whatsappLabel,'zh-CN':old.whatsappLabel}
      await write('source/plugins.json',plugins)
    }
    const assetMap=new Map<string,string>()
    for (const file of files.filter(file=>file.startsWith('assets/') && !file.endsWith('/.gitkeep'))) assetMap.set(file,`assets/uploads/legacy/${file.slice(7)}`)
    const resolver=(base:string)=>(raw:string):string=>{
      if (!raw || raw.startsWith('#') || /^(data:|mailto:|tel:)/i.test(raw)) return raw
      const url=new URL(raw,`https://legacy.invalid/${base}`)
      if (url.origin!=='https://legacy.invalid') return raw
      const target=assetMap.get(decodeURIComponent(url.pathname).slice(1))
      return target ? `/${target}${url.search}${url.hash}` : raw
    }
    for (const [file,destination] of assetMap) {
      const bytes=await fs.readFile(path.join(root,file))
      await fs.mkdir(path.dirname(path.join(staging,destination)),{recursive:true})
      if (file.endsWith('.css')) await fs.writeFile(path.join(staging,destination),rewriteCss(bytes.toString('utf8'),resolver(file)))
      else await fs.writeFile(path.join(staging,destination),bytes)
      const extension=path.extname(file).toLowerCase()
      if (!allowedExtensions.has(extension)) continue
      const mediaId=randomUUID()
      const metadata=['.png','.jpg','.jpeg','.webp','.gif','.svg'].includes(extension) ? await sharp(bytes).metadata() : null
      await write(`source/media/${mediaId}.json`,{schemaVersion:1,mediaId,path:destination,mimeType:lookup(file),size:bytes.length,width:metadata?.width??null,height:metadata?.height??null,title:{en:path.basename(file),'zh-CN':path.basename(file)},alt:{en:'','zh-CN':''},caption:{en:'','zh-CN':''},uploadedBy:input.userId,uploadedAt:now,updatedAt:now})
    }
    const defaultFiles=await safeFiles(path.join(staging,'source/pages'))
    const pluginConfig=JSON.parse(await fs.readFile(path.join(staging,'source/plugins.json'),'utf8'))
    const filterBlocks=(blocks:Array<{type:string;children?:unknown[]}>):unknown[]=>blocks.filter(block=>{
      const pluginId=block.type.startsWith('plugin/')?block.type.split('/')[1]:null
      return !pluginId || pluginConfig.plugins[pluginId]?.enabled===true
    }).map(block=>({...block,children:filterBlocks((block.children??[]) as Array<{type:string;children?:unknown[]}>)}))
    for(const file of defaultFiles.filter(file=>file.endsWith('.json') && !file.endsWith('/page.json'))){
      const value=JSON.parse(await fs.readFile(path.join(staging,'source/pages',file),'utf8'))
      value.blocks=filterBlocks(value.blocks)
      await write(`source/pages/${file}`,value)
    }
    for (const page of pages) {
      const locale=Intl.getCanonicalLocales(page.locale??'en')[0]!
      const slug=page.slug
      if (!slug || slug.startsWith('/') || slug.split('/').includes('..') || /[\\?#]/.test(slug)) throw new Error(`旧页面地址无效：${slug}`)
      for (const file of defaultFiles.filter(file=>file.endsWith(`/${locale}.json`))) {
        const full=path.join(staging,'source/pages',file)
        const existing=JSON.parse(await fs.readFile(full,'utf8'))
        if (existing.slug===slug) {
          existing.slug=`${existing.slug}-default`
          await fs.writeFile(full,`${JSON.stringify(existing,null,2)}\n`)
        }
      }
      await write(`source/pages/${page.pageId}/page.json`,{schemaVersion:1,pageId:page.pageId,role:null,template:'page',status:page.status==='published'?'published':'draft',createdAt:page.createdAt??now,updatedAt:page.updatedAt??now})
      await write(`source/pages/${page.pageId}/${locale}.json`,{schemaVersion:1,locale,slug,title:page.title,summary:'',cover:null,seo:{title:page.seo?.title??page.title,description:page.seo?.description??'',ogImage:null},blocks:[{id:randomUUID(),type:'core/html',props:{html:rewriteHtml(page.body.html,resolver(`${page.slug}/`))},children:[]}],sourceHash:null,updatedAt:page.updatedAt??now})
    }
    await write(convertedMarker,{schemaVersion:1,pageIds:pages.map(page=>page.pageId)})
    await buildSite(staging)
    await verifySite(staging)
    execFileSync('node',['tools/site-verify.mjs'],{cwd:staging,stdio:'pipe'})
    if (mapsApiKey && input.credentials) {
      const scope=`${input.siteId}/google-maps`
      const ciphertext=encryptCredential(JSON.stringify({apiKey:mapsApiKey}),scope)
      secretClient=await input.credentials.database.connect()
      await secretClient.query('BEGIN')
      await createCredentialSchema(secretClient)
      const ownership=await secretClient.query('SELECT 1 FROM site_drafts d JOIN site_owners o USING(site_id) WHERE d.draft_id=$1 AND d.site_id=$2 AND o.user_id=$3',[input.credentials.draftId,input.siteId,input.userId])
      if (!ownership.rowCount) throw new Error('FORBIDDEN')
      await fs.mkdir(path.join(root,'.olps-cache'),{recursive:true})
      const journal=await fs.open(path.join(root,recoveryFile),'wx',0o600)
      try {await journal.writeFile(JSON.stringify({siteId:input.siteId,draftId:input.credentials.draftId,scope,ciphertext}));await journal.sync()} finally {await journal.close()}
      await secretClient.query("INSERT INTO plugin_secrets(draft_id,site_id,plugin_id,ciphertext) VALUES($1,$2,'google-maps',$3) ON CONFLICT(draft_id,plugin_id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=NOW()",[input.credentials.draftId,input.siteId,ciphertext])
    }
    for (const name of managed) {
      if (files.some(file=>file===name || file.startsWith(`${name}/`))) await fs.cp(path.join(root,name),path.join(backup,name),{recursive:true})
      moved.push(name)
      await fs.rm(path.join(root,name),{recursive:true,force:true})
      await fs.cp(path.join(staging,name),path.join(root,name),{recursive:true})
    }
    git(['add','--',...managed])
    git(['-c','user.name=OLPS','-c','user.email=olps@localhost','commit','-m','转换网站内容格式'])
    gitCommitted=true
    if (secretClient) await secretClient.query('COMMIT')
    if(mapsApiKey) await fs.rm(path.join(root,recoveryFile),{force:true})
    if(encryptedLegacy)await fs.rm(path.join(root,'.olps-cache/legacy-credentials.json'),{force:true})
    return {convertedPageCount:pages.length,headCommitId:git(['rev-parse','HEAD'])}
  } catch(error) {
    if (secretClient) await secretClient.query('ROLLBACK')
    if(!gitCommitted) for (const name of moved) {
      await fs.rm(path.join(root,name),{recursive:true,force:true})
      const stat=await fs.stat(path.join(backup,name)).catch(error=>{if(error.code==='ENOENT') return null;throw error})
      if (stat) await fs.cp(path.join(backup,name),path.join(root,name),{recursive:true})
    }
    if(!gitCommitted && mapsApiKey) await fs.rm(path.join(root,recoveryFile),{force:true})
    throw error
  } finally {
    secretClient?.release()
    await fs.rm(staging,{recursive:true,force:true})
    await fs.rm(backup,{recursive:true,force:true})
  }
}

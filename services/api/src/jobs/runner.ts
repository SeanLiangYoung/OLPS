import { createHash,randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { BlockNode } from '@olps/domain'
import { loadBlockRegistry,loadSiteModel } from '@olps/render'
import { completeJson } from '../ai-client.js'
import { ContentError,readContent,saveContentBatch,withContentTransaction,type ManagedContent,type ContentContext,type ContentKind } from '../content-sandbox.js'
import { appendJobEvent,migrateJobEvents } from './events.js'
import { jobRequestSchema,jobTypes,validateGeneratedContent,nodeRequestSchema,type CmsJobType,type CmsJobRequest,type GenerationNodeRequest } from './schema.js'
import { assertDraftOrdinaryEditAllowed } from '../draft-ordinary-edit-guard.js'
import { sourceHashFor,canonicalJson } from './source-hash.js'

type Snapshot={content:ManagedContent;revision:string}
type JobSnapshot={input:CmsJobRequest;targets:Snapshot[];knowledge:Array<{documentId:string;title:string;content:string}>;strings?:{source:Record<string,unknown>;targetRevision:string|null;sourceRevision:string}}

function readerFor(context:ContentContext){return {readText:async(file:string)=>(await context.workspace.readFile(file)).toString(),list:async(directory:string)=>{
  const files=await context.workspace.listFiles(directory)
  return [...new Set(files.map(file=>file.slice(directory.length+1).split('/')[0]))].sort()
}}}

function canonical(value:unknown):string{
  return canonicalJson(value)
}

export async function submitCmsJob(context:ContentContext,type:CmsJobType,request:unknown,idempotencyKey:string):Promise<{jobId:string;type:CmsJobType;status:string}>{
  if(!jobTypes.includes(type)||!idempotencyKey||idempotencyKey.length>200)throw new ContentError('VALIDATION_FAILED')
  const input=jobRequestSchema.parse(request)
  if(input.draftId!==context.draftId)throw new ContentError('VALIDATION_FAILED')
  const client=await context.database.connect()
  try{await migrateJobEvents(client)}finally{client.release()}
  const hash=createHash('sha256').update(canonical(input)).digest('hex')
  const old=await context.database.query("SELECT j.*,r.request_hash FROM cms_job_requests r JOIN jobs j USING(job_id) WHERE r.user_id=$1 AND r.job_type=$2 AND r.idempotency_key=$3 AND j.created_at>NOW()-INTERVAL '24 hours'",[context.userId,type,idempotencyKey])
  if(old.rowCount){if(old.rows[0].request_hash!==hash)throw new ContentError('REVISION_CONFLICT');return {jobId:old.rows[0].job_id,type,status:old.rows[0].status}}
  const targets:Snapshot[]=[]
  if(input.target)targets.push(await readContent(context,input.target.ref,input.target.id,input.locale))
  if(['revise_node','rewrite_block','translate_node','generate_seo'].includes(type)&&!input.target)throw new ContentError('VALIDATION_FAILED',{field:'target'})
  if(type==='rewrite_block'&&!input.blockId)throw new ContentError('VALIDATION_FAILED',{field:'blockId'})
  if(['translate_node','translate_site','translate_strings'].includes(type)&&!input.targetLocale)throw new ContentError('VALIDATION_FAILED',{field:'targetLocale'})
  if(type==='generate_node'&&!input.node)throw new ContentError('VALIDATION_FAILED',{field:'node'})
  if(type==='generate_nodes'&&!input.nodes?.length)throw new ContentError('VALIDATION_FAILED',{field:'nodes'})
  const model=await loadSiteModel(readerFor(context))
  if(input.targetLocale&&!model.settings.locales.some(locale=>locale.code===input.targetLocale))throw new ContentError('VALIDATION_FAILED',{field:'targetLocale'})
  if(type.startsWith('translate_')&&input.targetLocale===model.settings.defaultLocale)throw new ContentError('VALIDATION_FAILED',{field:'targetLocale'})
  const sourceLocale=type.startsWith('translate_')?model.settings.defaultLocale:input.locale
  if(type==='translate_node'&&input.target&&sourceLocale!==input.locale)targets[0]=await readContent(context,input.target.ref,input.target.id,sourceLocale)
  let strings:JobSnapshot['strings']
  if(type==='translate_strings'){
    const sourceBytes=await context.workspace.readFile(`source/i18n/${sourceLocale}.json`)
    const targetFile=`source/i18n/${input.targetLocale}.json`
    const files=await context.workspace.listFiles('source/i18n')
    strings={source:JSON.parse(sourceBytes.toString()),sourceRevision:createHash('sha256').update(sourceBytes).digest('hex'),targetRevision:files.includes(targetFile)?createHash('sha256').update(await context.workspace.readFile(targetFile)).digest('hex'):null}
  }
  if(type==='translate_site'||type==='generate_legal_pages'){
    for(const page of model.pages){
      if(type==='generate_legal_pages'&&!['privacy','terms','cookies'].includes(String(page.meta.role)))continue
      if(page.locales[sourceLocale])targets.push(await readContent(context,'page',page.meta.pageId,sourceLocale))
    }
    if(type==='translate_site')for(const collection of model.collections){
      if(collection.indexLocales[sourceLocale])targets.push(await readContent(context,'collection',collection.definition.collectionId,sourceLocale))
      for(const group of collection.groups)if(group.locales[sourceLocale])targets.push(await readContent(context,'group',group.meta.groupId,sourceLocale))
      for(const item of collection.items)if(item.locales[sourceLocale])targets.push(await readContent(context,'item',item.meta.itemId,sourceLocale))
    }
  }
  if(type==='translate_site'&&input.scope==='outdated'){
    for(let index=targets.length-1;index>=0;index--){
      const target=targets[index]
      const id=nodeId(target.content)
      let localized:Snapshot|undefined
      try{localized=await readContent(context,target.content.ref,id,input.targetLocale!)}catch(error){if(!(error instanceof ContentError&&error.code==='NOT_FOUND'))throw error}
      if(localized?.content.locale.sourceHash===sourceHashFor(target.content.locale))targets.splice(index,1)
    }
  }
  return withContentTransaction(context,false,async client=>{
    const row=await client.query('SELECT site_id FROM site_drafts WHERE draft_id=$1',[context.draftId])
    const selected=[...new Set(input.knowledgeDocumentIds??[])]
    const knowledge:Array<{documentId:string;title:string;content:string}>=[]
    if(selected.length){
      const documents=await client.query('SELECT d.* FROM knowledge_documents d JOIN knowledge_bases k USING(kb_id) WHERE k.site_id=$1 AND d.doc_id=ANY($2::text[])',[row.rows[0].site_id,selected])
      if(documents.rowCount!==selected.length)throw new ContentError('FORBIDDEN',{field:'knowledgeDocumentIds'})
      knowledge.push(...documents.rows.map(document=>({documentId:document.doc_id,title:document.title,content:document.content})))
    }
    await client.query("DELETE FROM cms_job_requests r USING jobs j WHERE r.job_id=j.job_id AND r.user_id=$1 AND r.job_type=$2 AND r.idempotency_key=$3 AND j.created_at<=NOW()-INTERVAL '24 hours'",[context.userId,type,idempotencyKey])
    const concurrent=await client.query('SELECT j.*,r.request_hash FROM cms_job_requests r JOIN jobs j USING(job_id) WHERE r.user_id=$1 AND r.job_type=$2 AND r.idempotency_key=$3',[context.userId,type,idempotencyKey])
    if(concurrent.rowCount){if(concurrent.rows[0].request_hash!==hash)throw new ContentError('REVISION_CONFLICT');return {jobId:concurrent.rows[0].job_id,type,status:concurrent.rows[0].status}}
    const jobId=randomUUID()
    const snapshot:JobSnapshot={input,targets,knowledge,...(strings?{strings}:{})}
    await client.query("INSERT INTO jobs(job_id,user_id,draft_id,site_id,type,status,request,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'queued',$6,NOW(),NOW())",[jobId,context.userId,context.draftId,row.rows[0].site_id,type,snapshot])
    await client.query('INSERT INTO cms_job_requests VALUES($1,$2,$3,$4,$5)',[jobId,context.userId,type,idempotencyKey,hash])
    await client.query("INSERT INTO job_events(job_id,event_id,type,payload) VALUES($1,1,'job_queued','{}')",[jobId])
    return {jobId,type,status:'queued'}
  })
}

function nodeId(content:ManagedContent):string{return String(content.meta[`${content.ref}Id`])}
function newContent(node:NonNullable<CmsJobRequest['node']>,locale:string):ManagedContent{
  const now=new Date().toISOString()
  const meta:Record<string,unknown>={schemaVersion:1,[`${node.ref}Id`]:node.nodeId,status:'draft',createdAt:now,updatedAt:now,...node.meta}
  if(node.ref==='page')Object.assign(meta,{role:null,template:'page'})
  if(node.ref==='item')Object.assign(meta,{primaryGroupId:meta.primaryGroupId??null,groupIds:meta.groupIds??[],order:meta.order??0,publishedAt:null,fields:meta.fields??{}})
  if(node.ref==='collection')Object.assign(meta,{name:node.title,labels:{[locale]:node.title},prefix:meta.prefix??node.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),levels:meta.levels??[],fields:meta.fields??[],structuredData:meta.structuredData??null,feed:meta.feed??false})
  const localized:Record<string,unknown>={schemaVersion:1,locale,slug:node.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),title:node.title,summary:'',cover:null,seo:{title:node.title,description:'',ogImage:null},blocks:[],sourceHash:null,updatedAt:now}
  if(node.ref==='collection')delete localized.slug
  if(node.ref==='item')localized.fields={}
  return {ref:node.ref,meta,locale:localized,...(node.collectionId?{collectionId:node.collectionId}:{})}
}

const system='你为企业网站生成内容。只返回指定结构的 JSON 对象。事实以用户提供的知识库为准，禁止编造资料之外的事实。保持对象标识、区块标识、区块类型和未要求修改的内容。使用指定语言，每页只有一个主标题，标题层级连续，搜索标题最多60个字符、摘要最多160个字符。'

export async function runCmsJob(context:ContentContext,jobId:string):Promise<void>{
  const started=await context.database.query("UPDATE jobs SET status='running',updated_at=NOW() WHERE job_id=$1 AND user_id=$2 AND draft_id=$3 AND status='queued' RETURNING *",[jobId,context.userId,context.draftId])
  if(!started.rowCount)return
  const job=started.rows[0]
  const snapshot=job.request as JobSnapshot
  const input=snapshot.input
  try{
    await appendJobEvent(context.database,jobId,'job_started',{})
    await withContentTransaction(context,false,async client=>{
      const row=await client.query('SELECT * FROM site_drafts WHERE draft_id=$1',[context.draftId])
      assertDraftOrdinaryEditAllowed(row.rows[0])
    })
    const reader=readerFor(context)
    const model=await loadSiteModel(reader)
    const pluginIds=Object.entries(model.plugins.plugins).filter(([,plugin])=>plugin.enabled).map(([id])=>id)
    const registry=await loadBlockRegistry(reader,{themeId:model.appearance.themeId,enabledPluginIds:pluginIds})
    const catalogue=registry.list().map(block=>({type:block.type,name:block.name,description:block.description,fields:block.fields,accepts:block.accepts}))
    const prompt={request:input,knowledge:snapshot.knowledge,company:model.settings.company,plugins:model.plugins,connectors:model.publishConfig.connectors,blocks:catalogue}
    if(job.type==='propose_site_structure'){
      const result=await completeJson({system,user:JSON.stringify({...prompt,output:'{nodes:[{nodeId:UUID,ref:page|collection|group|item,title,requirements,collectionId?,meta?}]}'})})
      const structure=z.object({nodes:z.array(nodeRequestSchema)}).strict().parse(result)
      await finishJob(context,jobId,structure)
      return
    }
    if(job.type==='translate_strings'){
      const source=snapshot.strings!.source as {strings:Record<string,string>}
      if(!source)throw new ContentError('NOT_FOUND')
      const result=await completeJson({system,user:JSON.stringify({...prompt,source,output:'{strings: {key: translated string}}'})})
      const parsed=z.object({strings:z.record(z.string(),z.string())}).strict().parse(result)
      if(Object.keys(source.strings).sort().join('\0')!==Object.keys(parsed.strings).sort().join('\0'))throw new ContentError('VALIDATION_FAILED')
      await withContentTransaction(context,true,async(_client,backups)=>{
        const file=`source/i18n/${input.targetLocale}.json`
        const names=await context.workspace.listFiles('source/i18n')
        const current=names.includes(file)?await context.workspace.readFile(file):null
        const sourceBytes=await context.workspace.readFile(`source/i18n/${model.settings.defaultLocale}.json`)
        if((current?createHash('sha256').update(current).digest('hex'):null)!==snapshot.strings!.targetRevision||createHash('sha256').update(sourceBytes).digest('hex')!==snapshot.strings!.sourceRevision)throw new ContentError('REVISION_CONFLICT')
        backups.set(file,current)
        await context.workspace.writeFile(file,Buffer.from(JSON.stringify({schemaVersion:1,strings:parsed.strings})))
      })
      await finishJob(context,jobId,{locale:input.targetLocale})
      return
    }
    const prepared:Array<{content:ManagedContent;revision:string|null}>=[]
    const flatten=(nodes:GenerationNodeRequest[]):GenerationNodeRequest[]=>nodes.flatMap(node=>[node,...flatten(node.children??[])])
    const requests=job.type==='generate_nodes' ? flatten(input.nodes!) : job.type==='generate_node' ? [input.node!] : []
    if(new Set(requests.map(node=>node.nodeId)).size!==requests.length)throw new ContentError('VALIDATION_FAILED',{field:'nodeId'})
    const pending:Array<{content:ManagedContent;revision:string|null;node?:NonNullable<CmsJobRequest['node']>}>=requests.map(node=>({content:newContent(node,input.locale),revision:null,node}))
    pending.push(...snapshot.targets.map(target=>({...target})))
    if(!pending.length&&job.type==='translate_site'){await finishJob(context,jobId,{nodeIds:[]});return}
    if(!pending.length)throw new ContentError('VALIDATION_FAILED',{field:'target'})
    let failed=false
    for(const target of pending){
      const id=nodeId(target.content)
      await appendJobEvent(context.database,jobId,'node_started',{nodeId:id})
      try{
        const content=structuredClone(target.content)
        if(target.revision===null){
          const output=await completeJson({system,user:JSON.stringify({...prompt,node:target.node,content,output:'{locale:完整语言文件，包含locale、适用于URL的英文slug（collection没有slug）、title、summary、cover、seo、blocks空数组、sourceHash:null、updatedAt；item还需要fields。slug不得为空。保持content.meta对象所有固定字段。}'})})
          content.locale=z.object({locale:z.record(z.string(),z.unknown())}).strict().parse(output).locale
          if(content.locale.locale!==input.locale)throw new ContentError('VALIDATION_FAILED',{field:'locale'})
          content.locale.blocks=[]
        }
        if(job.type==='rewrite_block'){
          const find=(blocks:BlockNode[]):BlockNode|undefined=>{for(const block of blocks){if(block.id===input.blockId)return block;const nested=find(block.children);if(nested)return nested}return undefined}
          const block=find(content.locale.blocks as BlockNode[])
          if(!block)throw new ContentError('NOT_FOUND',{blockId:input.blockId})
          const output=await completeJson({system,user:JSON.stringify({...prompt,content,block,output:'{props: object}'})})
          block.props=z.object({props:z.record(z.string(),z.unknown())}).strict().parse(output).props
        }else if(job.type==='generate_seo'){
          const output=await completeJson({system,user:JSON.stringify({...prompt,content,output:'{seo:{title,description,ogImage:null|{mediaId}}}'})})
          content.locale.seo=z.object({seo:z.object({title:z.string().max(60),description:z.string().max(160),ogImage:z.object({mediaId:z.string()}).strict().nullable()}).strict()}).strict().parse(output).seo
        }else if(job.type==='translate_node'||job.type==='translate_site'){
          const output=await completeJson({system,user:JSON.stringify({...prompt,content,targetLocale:input.targetLocale,output:'{locale:完整目标语言文件，保持区块id/type/children结构与所有媒体ID和站内引用}'})})
          const localized=z.object({locale:z.record(z.string(),z.unknown())}).strict().parse(output).locale
          if(localized.locale!==input.targetLocale)throw new ContentError('VALIDATION_FAILED')
          const identity=(blocks:BlockNode[]):unknown=>blocks.map(block=>({id:block.id,type:block.type,children:identity(block.children)}))
          if(canonical(identity(content.locale.blocks as BlockNode[]))!==canonical(identity(localized.blocks as BlockNode[])))throw new ContentError('VALIDATION_FAILED',{field:'blocks'})
          localized.sourceHash=input.targetLocale===model.settings.defaultLocale?null:sourceHashFor(content.locale)
          content.locale=localized
        }else{
          const outline=z.object({blocks:z.array(z.object({id:z.string(),type:z.string(),requirements:z.string()}).strict())}).strict().parse(await completeJson({system,user:JSON.stringify({...prompt,content,node:target.node,output:'{blocks:[{id,type,requirements}]}区块大纲'})}))
          await appendJobEvent(context.database,jobId,'outline_completed',{nodeId:id,outline:outline.blocks})
          const blocks:BlockNode[]=[]
          for(const definition of outline.blocks){
            const output=z.object({props:z.record(z.string(),z.unknown()),children:z.array(z.unknown())}).strict().parse(await completeJson({system,user:JSON.stringify({...prompt,content,block:definition,output:'{props:符合区块fields的对象,children:区块子树数组}'})}))
            const block:BlockNode={id:definition.id,type:definition.type,props:output.props,children:output.children as BlockNode[]}
            const candidate={...content,locale:{...content.locale,blocks:[block]}}
            await validateGeneratedContent(candidate,reader,model.appearance.themeId,pluginIds)
            blocks.push(block)
            await appendJobEvent(context.database,jobId,'block_completed',{nodeId:id,blockId:block.id,blockType:block.type,props:block.props})
          }
          content.locale.blocks=blocks
        }
        await validateGeneratedContent(content,reader,model.appearance.themeId,pluginIds)
        prepared.push({content,revision:target.revision})
      }catch(error){
        if(job.type!=='generate_nodes')throw error
        failed=true
        await appendJobEvent(context.database,jobId,'node_failed',{nodeId:id,...failure(error)})
      }
    }
    if(job.type==='generate_nodes'){
      const key=(content:ManagedContent)=>`${content.ref}:${nodeId(content)}`
      const byKey=new Map(prepared.map(change=>[key(change.content),change]))
      const links=new Map([...byKey.keys()].map(id=>[id,new Set<string>()]))
      const inspect=(owner:string,value:unknown):void=>{
        if(Array.isArray(value)){for(const child of value)inspect(owner,child);return}
        if(!value||typeof value!=='object')return
        const record=value as Record<string,unknown>
        const reference=typeof record.ref==='string'&&typeof record.id==='string'?`${record.ref}:${record.id}`:null
        if(reference&&byKey.has(reference)){links.get(owner)!.add(reference);links.get(reference)!.add(owner)}
        for(const child of Object.values(record))inspect(owner,child)
      }
      for(const change of prepared){
        const content=change.content
        const owner=key(content)
        inspect(owner,content)
        const dependencies=[...(content.collectionId?[`collection:${content.collectionId}`]:[]),...[content.meta.parentGroupId,content.meta.primaryGroupId,...(Array.isArray(content.meta.groupIds)?content.meta.groupIds:[])].filter(Boolean).map(id=>`group:${id}`)]
        for(const dependency of dependencies)if(byKey.has(dependency)){links.get(owner)!.add(dependency);links.get(dependency)!.add(owner)}
      }
      const visited=new Set<string>()
      for(const owner of byKey.keys()){
        if(visited.has(owner))continue
        const component:string[]=[]
        const queue=[owner]
        while(queue.length){const next=queue.pop()!;if(visited.has(next))continue;visited.add(next);component.push(next);queue.push(...links.get(next)!)}
        const depth=(content:ManagedContent,ancestors:Set<string>=new Set()):number=>{
          if(content.ref!=='group'||!content.meta.parentGroupId)return 0
          const id=key(content)
          if(ancestors.has(id))throw new ContentError('VALIDATION_FAILED',{field:'parentGroupId'})
          ancestors.add(id)
          const parent=byKey.get(`group:${content.meta.parentGroupId}`)
          return parent?1+depth(parent.content,ancestors):0
        }
        const changes=component.map(id=>byKey.get(id)!)
        try{
          changes.sort((a,b)=>['collection','group','item','page'].indexOf(a.content.ref)-['collection','group','item','page'].indexOf(b.content.ref)||depth(a.content)-depth(b.content))
          await saveContentBatch(context,changes)
          for(const change of changes)await appendJobEvent(context.database,jobId,'node_completed',{nodeId:nodeId(change.content)})
        }catch(error){failed=true;for(const change of changes)await appendJobEvent(context.database,jobId,'node_failed',{nodeId:nodeId(change.content),...failure(error)})}
      }
    }else if(prepared.length){
      await saveContentBatch(context,prepared)
      for(const target of prepared)await appendJobEvent(context.database,jobId,'node_completed',{nodeId:nodeId(target.content)})
    }
    if(failed)throw new ContentError('VALIDATION_FAILED',{error:'存在生成失败的节点'})
    await finishJob(context,jobId,{nodeIds:pending.map(target=>nodeId(target.content))})
  }catch(error){
    const result=failure(error)
    await context.database.query("UPDATE jobs SET status='failed',error=$2,result=$3,updated_at=NOW() WHERE job_id=$1",[jobId,result.error,result])
    await appendJobEvent(context.database,jobId,'job_failed',result)
  }
}

function failure(error:unknown):{code:string;error:string;details:Record<string,unknown>}{return {code:error instanceof ContentError?error.code:'VALIDATION_FAILED',error:error instanceof Error?error.message:String(error),details:error instanceof ContentError?error.details:{}}}
async function finishJob(context:ContentContext,jobId:string,result:Record<string,unknown>):Promise<void>{
  await context.database.query("UPDATE jobs SET status='completed',result=$2,updated_at=NOW() WHERE job_id=$1",[jobId,result])
  await appendJobEvent(context.database,jobId,'job_completed',result)
}

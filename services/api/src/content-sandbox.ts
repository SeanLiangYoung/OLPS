import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type pg from 'pg'
import type { SyncWorkspace } from '@olps/sync'
import { assertValidSchema,validateCollectionFields,type CollectionDefinition,type MediaMeta } from '@olps/domain'
import { withDraftLock } from './draft-lock.js'
import { assertDraftOrdinaryEditAllowed } from './draft-ordinary-edit-guard.js'
import { createContentIndexSchema, indexContent, removeContentIndex } from './content-index.js'
import { resourceRevision } from './resource-revision.js'

export type ContentKind = 'page' | 'collection' | 'group' | 'item'
export type ManagedContent = { ref: ContentKind; meta: Record<string, unknown>; locale: Record<string, unknown>; collectionId?: string }
export type ContentContext = { workspace: SyncWorkspace; database: pg.Pool; draftId: string; userId: string }
export class ContentError extends Error {
  constructor(readonly code: string, readonly details: Record<string, unknown> = {}) { super(code) }
}

function token(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(value)) throw new ContentError('VALIDATION_FAILED')
  return value
}
function idFor(content: ManagedContent): string { return token(String(content.meta[`${content.ref === 'collection' ? 'collection' : content.ref}Id`] ?? '')) }

async function objectPaths(context: ContentContext, ref: ContentKind, id: string, collectionId?: string): Promise<{ meta: string; directory: string; collectionId?: string }> {
  token(id)
  if (ref === 'page') return { meta: `source/pages/${id}/page.json`, directory: `source/pages/${id}` }
  if (ref === 'collection') return { meta: `source/collections/${id}.json`, directory: `source/collections/${id}/index`, collectionId: id }
  if (!collectionId) {
    const suffix = `/${ref === 'group' ? 'groups' : 'items'}/${id}/${ref}.json`
    const found = (await context.workspace.listFiles('source/collections')).find(file => file.endsWith(suffix))
    if (!found) throw new ContentError('NOT_FOUND')
    collectionId = found.split('/')[2]
  }
  token(collectionId)
  const directory = `source/collections/${collectionId}/${ref === 'group' ? 'groups' : 'items'}/${id}`
  return { meta: `${directory}/${ref}.json`, directory, collectionId }
}

async function objectFiles(context: ContentContext, paths: { meta: string; directory: string }): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  const names = await context.workspace.listFiles('source')
  for (const file of names.filter(file => file === paths.meta || (file.startsWith(`${paths.directory}/`) && file.endsWith('.json')))) files.set(file, await context.workspace.readFile(file))
  return files
}

function revisionOf(files: Map<string, Buffer>): string {
  const hash = createHash('sha256')
  for (const [name,bytes] of [...files.entries()].sort(([a],[b]) => a.localeCompare(b))) hash.update(name).update('\0').update(bytes).update('\0')
  return `sha256:${hash.digest('hex')}`
}

async function authorize(context: ContentContext, client: pg.PoolClient, write: boolean): Promise<void> {
  const row = await client.query('SELECT d.* FROM site_drafts d JOIN draft_owners o ON d.draft_id=o.draft_id WHERE d.draft_id=$1 AND o.user_id=$2 FOR UPDATE OF d',[context.draftId,context.userId])
  if (!row.rowCount) throw new ContentError('FORBIDDEN')
  if (write) assertDraftOrdinaryEditAllowed(row.rows[0])
}

async function transaction<T>(context: ContentContext, write: boolean, action: (client: pg.PoolClient, backups: Map<string, Buffer | null>) => Promise<T>): Promise<T> {
  return withDraftLock(context.draftId, () => transactionUnlocked(context,write,action))
}

async function transactionUnlocked<T>(context: ContentContext, write: boolean, action: (client: pg.PoolClient, backups: Map<string, Buffer | null>) => Promise<T>): Promise<T> {
    const client = await context.database.connect()
    const backups = new Map<string, Buffer | null>()
    try {
      await client.query('BEGIN')
      await authorize(context,client,write)
      const result = await action(client,backups)
      if (write) await client.query("UPDATE site_drafts SET sync_status='dirty',updated_at=NOW() WHERE draft_id=$1",[context.draftId])
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      for (const [file,bytes] of backups) {
        if (bytes === null) await fs.rm(path.join(context.workspace.getState().workspacePath,file),{force:true})
        else await context.workspace.writeFile(file,bytes)
      }
      throw error
    } finally { client.release() }
}

export const withContentTransaction = transaction

async function readUnlocked(context: ContentContext,ref: ContentKind,id: string,locale: string): Promise<{content: ManagedContent; revision: string}> {
  const paths = await objectPaths(context,ref,id)
  const files = await objectFiles(context,paths)
  const meta = files.get(paths.meta)
  const localized = files.get(`${paths.directory}/${token(locale)}.json`)
  if (!meta || !localized) throw new ContentError('NOT_FOUND')
  return { content: {ref,meta:JSON.parse(meta.toString()),locale:JSON.parse(localized.toString()),...(paths.collectionId ? {collectionId:paths.collectionId}: {})}, revision: revisionOf(files) }
}

export async function readContent(context: ContentContext,ref: ContentKind,id: string,locale: string): Promise<{content:ManagedContent;revision:string}> {
  return transaction(context,false,async () => readUnlocked(context,ref,id,locale))
}

function validateContent(content: ManagedContent): void {
  const ref = content.ref
  const metaSchema = ref === 'collection' ? 'collection' : `${ref}-meta`
  const localeSchema = ref === 'collection' ? 'collection-index-locale' : `${ref}-locale`
  assertValidSchema(metaSchema as Parameters<typeof assertValidSchema>[0],content.meta,'content.meta')
  assertValidSchema(localeSchema as Parameters<typeof assertValidSchema>[0],content.locale,'content.locale',ref === 'page' ? {pageRole:content.meta.role as never}:undefined)
  token(String(content.locale.locale))
}

async function usagesOf(context: ContentContext, ref: ContentKind, id: string, ownFiles: Set<string>): Promise<Array<{path: string; field: string}>> {
  const usages: Array<{path:string;field:string}> = []
  const inspect = (value: unknown,file: string,field: string): void => {
    if (Array.isArray(value)) { value.forEach((item,index) => inspect(item,file,`${field}[${index}]`)); return }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string,unknown>
    if (record.ref === ref && record.id === id) usages.push({path:file,field})
    if (ref === 'group' && (record.parentGroupId === id || record.primaryGroupId === id || (Array.isArray(record.groupIds) && record.groupIds.includes(id)))) usages.push({path:file,field})
    for (const [key,nested] of Object.entries(record)) inspect(nested,file,field ? `${field}.${key}` : key)
  }
  for (const file of await context.workspace.listFiles('source')) {
    if (ownFiles.has(file) || file === 'source/redirects.json' || !file.endsWith('.json')) continue
    if (ref === 'collection' && file.startsWith(`source/collections/${id}/`) && /\/(groups|items)\//.test(file)) usages.push({path:file,field:''})
    inspect(JSON.parse((await context.workspace.readFile(file)).toString()),file,'')
  }
  return usages
}

async function routeOf(context:ContentContext,content:ManagedContent):Promise<string> {
  const locale = token(String(content.locale.locale))
  if (content.ref === 'page') return content.meta.role === 'not-found' ? `/${locale}/404.html` : `/${locale}/${content.locale.slug ? `${content.locale.slug}/`:''}`
  const definition = content.ref === 'collection' ? content.meta : JSON.parse((await context.workspace.readFile(`source/collections/${token(content.collectionId!) }.json`)).toString())
  const prefix = String(definition.prefix)
  if (content.ref === 'collection') return `/${locale}/${prefix}/`
  if (content.ref === 'item') return `/${locale}/${prefix}/${content.locale.slug}/`
  const slugs = [String(content.locale.slug)]
  const seen = new Set<string>([idFor(content)])
  let parent = content.meta.parentGroupId as string|null
  while (parent) {
    if (seen.has(parent)) throw new ContentError('VALIDATION_FAILED',{field:'parentGroupId'})
    seen.add(parent)
    const group = (await readUnlocked(context,'group',parent,locale)).content
    slugs.unshift(String(group.locale.slug))
    parent = group.meta.parentGroupId as string|null
  }
  return `/${locale}/${prefix}/${slugs.join('/')}/`
}

async function writeManagedFile(context:ContentContext,file:string,bytes:Buffer,backups:Map<string,Buffer|null>):Promise<void> {
  if (!backups.has(file)) {
    const exists = (await context.workspace.listFiles('source')).includes(file)
    backups.set(file,exists ? await context.workspace.readFile(file):null)
  }
  await fs.mkdir(path.dirname(path.join(context.workspace.getState().workspacePath,file)),{recursive:true})
  await context.workspace.writeFile(file,bytes)
}

function collectionImpact(before: Record<string,unknown>, after: Record<string,unknown>): boolean {
  const oldLevels = before.levels as Array<{levelId:string}>
  const nextLevels = after.levels as Array<{levelId:string}>
  if (oldLevels.some((level,index) => nextLevels[index]?.levelId !== level.levelId)) return true
  const oldFields = before.fields as Array<Record<string,unknown>>
  const nextFields = after.fields as Array<Record<string,unknown>>
  if(nextFields.some(field=>field.required&&!oldFields.some(previous=>previous.key===field.key)))return true
  return oldFields.some(field => {
    const next = nextFields.find(candidate => candidate.key === field.key)
    if(!next||['type','translatable','referenceCollectionId'].some(key=>next[key]!==field[key])||(!field.required&&next.required))return true
    if(field.type==='select'&&(field.options as Array<{value:string}>).some(option=>!(next.options as Array<{value:string}>).some(candidate=>candidate.value===option.value)))return true
    if(field.type==='table'&&JSON.stringify((field.columns as Array<{key:string;type:string}>).map(column=>[column.key,column.type]))!==JSON.stringify((next.columns as Array<{key:string;type:string}>).map(column=>[column.key,column.type])))return true
    return false
  })
}

async function assertReferencesExist(context:ContentContext,content:ManagedContent,pendingReferences:Set<string>=new Set()):Promise<void> {
  const sourceFiles=new Set(await context.workspace.listFiles('source'))
  const references:Array<{ref:ContentKind;id:string}>=[]
  const mediaIds:string[]=[]
  const inspect=(value:unknown):void=>{
    if(Array.isArray(value)){for(const child of value)inspect(child);return}
    if(!value || typeof value!=='object')return
    const record=value as Record<string,unknown>
    if(['page','collection','group','item'].includes(String(record.ref)) && typeof record.id==='string') references.push({ref:record.ref as ContentKind,id:record.id})
    if(typeof record.mediaId==='string')mediaIds.push(record.mediaId)
    for(const child of Object.values(record))inspect(child)
  }
  inspect(content)
  for(const reference of references){
    if(reference.ref===content.ref && reference.id===idFor(content))continue
    if(pendingReferences.has(`${reference.ref}:${reference.id}`))continue
    const paths=await objectPaths(context,reference.ref,reference.id)
    if(!sourceFiles.has(paths.meta))throw new ContentError('VALIDATION_FAILED',{reference})
  }
  for(const id of mediaIds)if(!sourceFiles.has(`source/media/${token(id)}.json`))throw new ContentError('VALIDATION_FAILED',{mediaId:id})
}

async function assertItemFields(context:ContentContext,content:ManagedContent,pendingReferences:Set<string>=new Set()):Promise<void>{
  if(content.ref!=='item')return
  const collectionId=token(content.collectionId!)
  const definition=JSON.parse((await context.workspace.readFile(`source/collections/${collectionId}.json`)).toString()) as CollectionDefinition
  const errors=validateCollectionFields(definition.fields,content.meta.fields,content.locale.fields)
  if(errors.length)throw new ContentError('VALIDATION_FAILED',{fields:errors})
  const sourceFiles=new Set(await context.workspace.listFiles('source'))
  for(const field of definition.fields.filter(field=>field.type==='reference')){
    const values=(field.translatable?content.locale.fields:content.meta.fields) as Record<string,unknown>
    const reference=values[field.key] as {ref:'item';id:string}|null|undefined
    if(!reference)continue
    if(reference.id===idFor(content)&&field.referenceCollectionId===collectionId)continue
    if(pendingReferences.has(`item:${reference.id}:collection:${field.referenceCollectionId}`))continue
    if(!sourceFiles.has(`source/collections/${token(field.referenceCollectionId!)}/items/${token(reference.id)}/item.json`))throw new ContentError('VALIDATION_FAILED',{field:`fields.${field.key}`,referenceCollectionId:field.referenceCollectionId})
  }
}

async function writeContentInTransaction(context: ContentContext, content: ManagedContent, expected: string | null,client:pg.PoolClient,backups:Map<string,Buffer|null>,pendingReferences:Set<string>=new Set()): Promise<{content:ManagedContent;revision:string}> {
  content=structuredClone(content)
  validateContent(content)
  const id = idFor(content)
    const paths = await objectPaths(context,content.ref,id,content.collectionId)
    const files = await objectFiles(context,paths)
    const exists = files.has(paths.meta)
    if(!exists&&(content.ref==='group'||content.ref==='item')){
      const suffix=`/${content.ref==='group'?'groups':'items'}/${id}/${content.ref}.json`
      if((await context.workspace.listFiles('source/collections')).some(file=>file.endsWith(suffix)))throw new ContentError('REVISION_CONFLICT',{field:`meta.${content.ref}Id`})
    }
    if (expected === null && exists) throw new ContentError('REVISION_CONFLICT',{currentRevision:revisionOf(files)})
    if (expected !== null && (!exists || expected !== revisionOf(files))) throw new ContentError('REVISION_CONFLICT',{currentRevision:revisionOf(files)})
    if(exists){
      const previousMeta=JSON.parse(files.get(paths.meta)!.toString())
      if(content.ref==='page' && previousMeta.role!==content.meta.role)throw new ContentError('VALIDATION_FAILED',{field:'meta.role'})
      content.meta.createdAt=previousMeta.createdAt
      content.meta.updatedAt=new Date(Math.max(Date.now(),Date.parse(previousMeta.updatedAt)+1)).toISOString()
      content.locale.updatedAt=content.meta.updatedAt
    }
    if (content.ref === 'group' || content.ref === 'item') {
      const definition = JSON.parse((await context.workspace.readFile(`source/collections/${paths.collectionId}.json`)).toString()) as CollectionDefinition
      await assertItemFields(context,{...content,collectionId:paths.collectionId},pendingReferences)
      if (content.ref === 'group' && !definition.levels.some((level: {levelId:string}) => level.levelId === content.meta.levelId)) throw new ContentError('VALIDATION_FAILED',{field:'meta.levelId'})
      const groupIds = content.ref === 'group' ? [content.meta.parentGroupId].filter(Boolean) : [...new Set([...(content.meta.groupIds as string[]),content.meta.primaryGroupId].filter(Boolean))]
      const levelIndex=content.ref==='group'?definition.levels.findIndex((level:{levelId:string})=>level.levelId===content.meta.levelId):-1
      if(content.ref==='group' && !content.meta.parentGroupId && levelIndex!==0)throw new ContentError('VALIDATION_FAILED',{field:'meta.levelId'})
      for (const groupId of groupIds) {
        if (groupId === id) throw new ContentError('VALIDATION_FAILED',{field:'meta.parentGroupId'})
        const parent=JSON.parse((await context.workspace.readFile(`source/collections/${paths.collectionId}/groups/${token(String(groupId))}/group.json`)).toString())
        if(content.ref==='group' && definition.levels[levelIndex-1]?.levelId!==parent.levelId)throw new ContentError('VALIDATION_FAILED',{field:'meta.parentGroupId'})
      }
    }
    await assertReferencesExist(context,content,pendingReferences)
    if (content.ref === 'collection' && exists && collectionImpact(JSON.parse(files.get(paths.meta)!.toString()),content.meta)) {
      const usages = await usagesOf(context,'collection',id,new Set(files.keys()))
      if (usages.length) {
        const affected=new Map<string,{ref:string;id:string}>()
        for(const usage of usages){
          const parts=usage.path.split('/')
          if(parts[3]==='groups'||parts[3]==='items')affected.set(`${parts[3]}/${parts[4]}`,{ref:parts[3]==='groups'?'group':'item',id:parts[4]})
        }
        const objects=[...affected.values()]
        throw new ContentError('RESOURCE_IN_USE',{usages:usages.slice(0,100),groupCount:objects.filter(object=>object.ref==='group').length,itemCount:objects.filter(object=>object.ref==='item').length,objects:objects.slice(0,100)})
      }
    }
    if(content.ref==='collection'){
      const sourceFiles=new Set(await context.workspace.listFiles('source'))
      for(const field of (content.meta.fields as CollectionDefinition['fields']).filter(field=>field.type==='reference')){
        const target=token(field.referenceCollectionId!)
        if(target!==id&&!pendingReferences.has(`collection:${target}`)&&!sourceFiles.has(`source/collections/${target}.json`))throw new ContentError('VALIDATION_FAILED',{field:`fields.${field.key}.referenceCollectionId`})
      }
    }
    const next = new Map(files)
    next.set(paths.meta,Buffer.from(`${JSON.stringify(content.meta,null,2)}\n`))
    next.set(`${paths.directory}/${content.locale.locale}.json`,Buffer.from(`${JSON.stringify(content.locale,null,2)}\n`))
    const revision = revisionOf(next)
    for (const [file,bytes] of next) {
      if (file === paths.meta) continue
      const localized=JSON.parse(bytes.toString())
      if(file!==`${paths.directory}/${content.locale.locale}.json`)await assertItemFields(context,{...content,locale:localized,collectionId:paths.collectionId},pendingReferences)
      await indexContent(client,context.draftId,content.ref,id,paths.collectionId,content.meta,localized,revision)
    }
    const previousLocalized = files.get(`${paths.directory}/${content.locale.locale}.json`)
    let redirectBytes:Buffer|undefined
    if (exists && previousLocalized) {
      const before = {...content,meta:JSON.parse(files.get(paths.meta)!.toString()),locale:JSON.parse(previousLocalized.toString()),collectionId:paths.collectionId}
      const from = await routeOf(context,before)
      const to = await routeOf(context,{...content,collectionId:paths.collectionId})
      if (from!==to) {
        const config = JSON.parse((await context.workspace.readFile('source/redirects.json')).toString())
        config.redirects = config.redirects.filter((redirect:{from:string;locale:string}) => !(redirect.from===from && redirect.locale===content.locale.locale))
        config.redirects.push({redirectId:randomUUID(),locale:content.locale.locale,from,target:{ref:content.ref,id},createdAt:new Date().toISOString()})
        assertValidSchema('redirects',config,'source/redirects.json')
        redirectBytes = Buffer.from(`${JSON.stringify(config,null,2)}\n`)
      }
    }
    for (const [file,bytes] of next) {
      if (files.get(file)?.equals(bytes)) continue
      if(!backups.has(file))backups.set(file,files.get(file) ?? null)
      await fs.mkdir(path.dirname(path.join(context.workspace.getState().workspacePath,file)),{recursive:true})
      await context.workspace.writeFile(file,bytes)
    }
    if (redirectBytes) await writeManagedFile(context,'source/redirects.json',redirectBytes,backups)
    return {content,revision}
}

async function writeContent(context:ContentContext,content:ManagedContent,expected:string|null):Promise<{content:ManagedContent;revision:string}>{
  return transaction(context,true,(client,backups)=>writeContentInTransaction(context,content,expected,client,backups))
}

export async function saveContentBatch(context:ContentContext,changes:Array<{content:ManagedContent;revision:string|null}>):Promise<Array<{content:ManagedContent;revision:string}>>{
  const keys=changes.map(change=>`${change.content.ref}:${idFor(change.content)}`)
  if(new Set(keys).size!==keys.length)throw new ContentError('VALIDATION_FAILED',{field:'changes'})
  for(const change of changes)validateContent(change.content)
  return transaction(context,true,async(client,backups)=>{
    const result:Array<{content:ManagedContent;revision:string}>=[]
    const pendingReferences=new Set([...keys,...changes.filter(change=>change.content.ref==='item').map(change=>`item:${idFor(change.content)}:collection:${change.content.collectionId}`)])
    for(const change of changes)result.push(await writeContentInTransaction(context,change.content,change.revision,client,backups,pendingReferences))
    return result
  })
}

export async function createContent(context: ContentContext,content: ManagedContent): Promise<{content:ManagedContent;revision:string}> { return writeContent(context,content,null) }
export async function saveContent(context: ContentContext,id: string,content: ManagedContent,revision: string): Promise<{content:ManagedContent;revision:string}> {
  if (idFor(content) !== id) throw new ContentError('VALIDATION_FAILED')
  return writeContent(context,content,revision)
}

export async function deleteContent(context: ContentContext,ref: ContentKind,id: string,revision: string): Promise<void> {
  await transaction(context,true,async (client,backups) => {
    const paths = await objectPaths(context,ref,id)
    const files = await objectFiles(context,paths)
    if (!files.has(paths.meta)) throw new ContentError('NOT_FOUND')
    if (revisionOf(files) !== revision) throw new ContentError('REVISION_CONFLICT',{currentRevision:revisionOf(files)})
    const meta = JSON.parse(files.get(paths.meta)!.toString())
    if (ref === 'page' && meta.role) throw new ContentError('RESOURCE_IN_USE',{role:meta.role})
    const usages = await usagesOf(context,ref,id,new Set(files.keys()))
    if (usages.length) throw new ContentError('RESOURCE_IN_USE',{usages})
    await removeContentIndex(client,context.draftId,ref,id)
    const redirects = JSON.parse((await context.workspace.readFile('source/redirects.json')).toString())
    const retained = redirects.redirects.filter((redirect:{target:{ref:string;id:string}}) => !(redirect.target.ref===ref && redirect.target.id===id))
    if (retained.length !== redirects.redirects.length) await writeManagedFile(context,'source/redirects.json',Buffer.from(`${JSON.stringify({...redirects,redirects:retained},null,2)}\n`),backups)
    for (const [file,bytes] of files) {
      backups.set(file,bytes)
      await fs.rm(path.join(context.workspace.getState().workspacePath,file))
    }
  })
}

export async function listContent(context: ContentContext,ref: ContentKind,options: {locale?:string;collectionId?:string;q?:string;status?:string;limit?:number;cursor?:string} = {}): Promise<{contents:ManagedContent[];pageInfo:{nextCursor:string|null;hasNextPage:boolean}}> {
  const limit = options.limit ?? 50
  if (!Number.isInteger(limit) || limit<1 || limit>100) throw new ContentError('VALIDATION_FAILED',{field:'limit'})
  let after = ''
  if (options.cursor) {
    const parsed = JSON.parse(Buffer.from(options.cursor,'base64url').toString()) as unknown
    if (typeof parsed !== 'string') throw new ContentError('VALIDATION_FAILED',{field:'cursor'})
    after = token(parsed)
  }
  return transaction(context,false,async client => {
    const table = ref === 'page' ? 'pages' : ref === 'collection' ? 'collection_indexes' : ref === 'group' ? 'collection_groups' : 'collection_items'
    const key = ref === 'page' ? 'page_id' : ref === 'collection' ? 'collection_id' : ref === 'group' ? 'group_id' : 'item_id'
    const values: unknown[] = [context.draftId,options.locale ?? 'en',after]
    const conditions = ['draft_id=$1','locale=$2',`${key}>$3`]
    if (options.collectionId && (ref === 'group' || ref === 'item')) { values.push(token(options.collectionId)); conditions.push(`collection_id=$${values.length}`) }
    if (options.status) { values.push(options.status); conditions.push(`status=$${values.length}`) }
    if (options.q) { values.push(`%${options.q}%`); conditions.push(`title ILIKE $${values.length}`) }
    values.push(limit+1)
    const rows = await client.query(`SELECT ${key} AS id FROM ${table} WHERE ${conditions.join(' AND ')} ORDER BY ${key} LIMIT $${values.length}`,values)
    const contents:ManagedContent[] = []
    for (const row of rows.rows.slice(0,limit)) contents.push((await readUnlocked(context,ref,row.id,options.locale ?? 'en')).content)
    const hasNextPage = rows.rows.length>limit
    return {contents,pageInfo:{hasNextPage,nextCursor:hasNextPage ? Buffer.from(JSON.stringify(rows.rows[limit-1].id)).toString('base64url') : null}}
  })
}

export async function reorderContent(context:ContentContext,collectionId:string,ref:'group'|'item',orders:Array<{id:string;order:number}>,expectedRevision:string,locale='en'):Promise<{revision:string}> {
  if (new Set(orders.map(entry=>entry.id)).size!==orders.length || orders.some(entry=>!Number.isInteger(entry.order))) throw new ContentError('VALIDATION_FAILED')
  return transaction(context,true,async (client,backups)=>{
    const collection = await readUnlocked(context,'collection',collectionId,locale)
    if (collection.revision!==expectedRevision) throw new ContentError('REVISION_CONFLICT',{currentRevision:collection.revision})
    const changes = new Map<string,Buffer>()
    for (const entry of orders) {
      const paths = await objectPaths(context,ref,entry.id,collectionId)
      const files = await objectFiles(context,paths)
      const metaBytes = files.get(paths.meta)
      if (!metaBytes) throw new ContentError('NOT_FOUND')
      const meta = {...JSON.parse(metaBytes.toString()),order:entry.order,updatedAt:new Date().toISOString()}
      files.set(paths.meta,Buffer.from(`${JSON.stringify(meta,null,2)}\n`))
      const revision = revisionOf(files)
      for (const [file,bytes] of files) if(file!==paths.meta) await indexContent(client,context.draftId,ref,entry.id,collectionId,meta,JSON.parse(bytes.toString()),revision)
      changes.set(paths.meta,files.get(paths.meta)!)
    }
    const parentPaths = await objectPaths(context,'collection',collectionId)
    const parentFiles = await objectFiles(context,parentPaths)
    const meta = {...collection.content.meta,updatedAt:new Date(Math.max(Date.now(),Date.parse(String(collection.content.meta.updatedAt))+1)).toISOString()}
    parentFiles.set(parentPaths.meta,Buffer.from(`${JSON.stringify(meta,null,2)}\n`))
    const revision = revisionOf(parentFiles)
    for(const [file,bytes] of parentFiles) if(file!==parentPaths.meta) await indexContent(client,context.draftId,'collection',collectionId,collectionId,meta,JSON.parse(bytes.toString()),revision)
    changes.set(parentPaths.meta,parentFiles.get(parentPaths.meta)!)
    for(const [file,bytes] of changes) await writeManagedFile(context,file,bytes,backups)
    return {revision}
  })
}

export async function refreshContentIndexes(context:ContentContext):Promise<void> {
  await withDraftLock(context.draftId,()=>refreshContentIndexesUnlocked(context))
}

export async function refreshContentIndexesUnlocked(context:ContentContext):Promise<void> {
  await transactionUnlocked(context,false,async client=>{
    await createContentIndexSchema(client)
    for(const table of ['pages','collection_indexes','collection_groups','collection_items','media']) await client.query(`DELETE FROM ${table} WHERE draft_id=$1`,[context.draftId])
    const files=await context.workspace.listFiles('source')
    for(const file of files.filter(file=>/^source\/media\/[^/]+\.json$/.test(file))){
      const bytes=await context.workspace.readFile(file)
      const media=JSON.parse(bytes.toString()) as MediaMeta
      assertValidSchema('media',media,file)
      if(file!==`source/media/${token(media.mediaId)}.json`)throw new ContentError('VALIDATION_FAILED',{field:'mediaId',path:file})
      const asset=await context.workspace.readFile(media.path)
      if(asset.length!==media.size)throw new ContentError('VALIDATION_FAILED',{field:'size',mediaId:media.mediaId})
      await client.query('INSERT INTO media(draft_id,media_id,data,revision) VALUES($1,$2,$3,$4)',[context.draftId,media.mediaId,media,resourceRevision(bytes)])
    }
    const definitions:Array<{ref:ContentKind;id:string;collectionId?:string}>=[]
    for(const file of files){
      const parts=file.split('/')
      if(parts.length===4 && parts[1]==='pages' && parts[3]==='page.json') definitions.push({ref:'page',id:parts[2]})
      if(parts.length===3 && parts[1]==='collections' && parts[2].endsWith('.json')) definitions.push({ref:'collection',id:parts[2].slice(0,-5)})
      if(parts.length===6 && parts[1]==='collections' && parts[3]==='groups' && parts[5]==='group.json') definitions.push({ref:'group',id:parts[4],collectionId:parts[2]})
      if(parts.length===6 && parts[1]==='collections' && parts[3]==='items' && parts[5]==='item.json') definitions.push({ref:'item',id:parts[4],collectionId:parts[2]})
    }
    for(const definition of definitions){
      const paths=await objectPaths(context,definition.ref,definition.id,definition.collectionId)
      const managed=await objectFiles(context,paths)
      const meta=JSON.parse(managed.get(paths.meta)!.toString())
      const revision=revisionOf(managed)
      for(const [file,bytes]of managed){
        if(file===paths.meta)continue
        const localized=JSON.parse(bytes.toString())
        validateContent({ref:definition.ref,meta,locale:localized,collectionId:paths.collectionId})
        await assertItemFields(context,{ref:definition.ref,meta,locale:localized,collectionId:paths.collectionId})
        await indexContent(client,context.draftId,definition.ref,definition.id,paths.collectionId,meta,localized,revision)
      }
    }
  })
}

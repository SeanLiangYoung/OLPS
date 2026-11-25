<script setup lang="ts">
import { computed,onBeforeUnmount,ref,watch } from 'vue'
import { onBeforeRouteLeave,onBeforeRouteUpdate,useRoute,useRouter } from 'vue-router'
import type { BlockNode,BlockFieldDefinition,FieldDefinition,ContentRef } from '@olps/domain'
import { validateSchema,validateCollectionFields } from '@olps/domain'
import { loadSiteModel,loadBlockRegistry,renderTarget,validateBlockProps,type SourceReader,type SiteModel } from '@olps/render'
import { api,ApiError } from '../api'
import { requireSelectedDraftId } from '../draft'
import { selectedDraftIdState } from '../workspaceSession'
import { EditorHistory } from '../editor/history'
import { createApiSourceReader,createOverlaySourceReader } from '../editor/source-reader'
import { createCanvasDocument,type ResourceAccess } from '../editor/canvas'
import { changeBlock,findBlock,removeBlock,freshBlock,type EditorContent,type EditorDocument } from '../editor/document'
import type { RegisteredBlock } from '../editor/types'
import { inspectSeo } from '../editor/seo'
import { watchEditorJob } from '../editor/job-stream'
import { translationSourceHash } from '../editor/translation'
import { clearEditorResources,editorResourceRefreshDelay } from '../editor/resources'
import { pageEditSnapshot,applySavedPageMetadata,protectPageUnload } from '../pageEditSession'
import BlockOutline from '../editor/BlockOutline.vue'
import FieldControl from '../editor/FieldControl.vue'
import CmsFieldEditor from '../editor/CmsFieldEditor.vue'
import MediaPicker from '../editor/MediaPicker.vue'

const route=useRoute()
const router=useRouter()
const content=ref<EditorContent>()
const revision=ref('')
const saved=ref('')
const model=ref<SiteModel>()
const definitions=ref<RegisteredBlock[]>([])
const access=ref<ResourceAccess>()
const draftId=ref('')
const selectedId=ref('')
const width=ref(1280)
const frame=ref<HTMLIFrameElement>()
const frameHtml=ref('')
const renderedHtml=ref('')
const loading=ref(false)
const saving=ref(false)
const generating=ref(false)
const error=ref('')
const renderError=ref('')
const message=ref('')
const conflict=ref(false)
const outlineOpen=ref(true)
const settingsOpen=ref(true)
const instruction=ref('')
const aiBlocks=ref<BlockNode[]|null>(null)
const historyVersion=ref(0)
const templates=ref<Array<{id:string;name:string}>>([])
const missingTranslationSource=ref<EditorDocument>()
const defaultSourceHash=ref('')
let history:EditorHistory<EditorContent>|undefined
let sourceReader:SourceReader|undefined
let loadingEpoch=0
let renderingEpoch=0
let streamController:AbortController|undefined
let accessTimer:ReturnType<typeof setTimeout>|undefined

function editableSnapshot(value:EditorContent):string{
  return pageEditSnapshot(value)
}
const dirty=computed(()=>Boolean(content.value&&editableSnapshot(content.value)!==saved.value))
const selected=computed(()=>content.value?findBlock(content.value.locale.blocks,selectedId.value):undefined)
const selectedDefinition=computed(()=>definitions.value.find(definition=>definition.type===selected.value?.type))
const canUndo=computed(()=>{historyVersion.value;return Boolean(history?.canUndo)})
const canRedo=computed(()=>{historyVersion.value;return Boolean(history?.canRedo)})
const locale=computed(()=>content.value?.locale.locale??String(route.query.locale??'en'))
const currentId=computed(()=>String(route.params.id??route.params.pageId??''))
const currentRef=computed(()=>String(route.params.ref??'page') as ContentRef['ref'])
const currentCollection=computed(()=>model.value?.collections.find(collection=>collection.definition.collectionId===content.value?.collectionId))
const customFields=computed(()=>content.value?.ref==='item'?currentCollection.value?.definition.fields??[]:[])
const links=computed(()=>{
  if(!model.value)return []
  const result:Array<{target:ContentRef;title:string}>=[]
  for(const page of model.value.pages)if(page.locales[locale.value])result.push({target:{ref:'page',id:page.meta.pageId},title:page.locales[locale.value].title})
  for(const collection of model.value.collections){
    if(collection.indexLocales[locale.value])result.push({target:{ref:'collection',id:collection.definition.collectionId},title:collection.indexLocales[locale.value].title})
    for(const group of collection.groups)if(group.locales[locale.value])result.push({target:{ref:'group',id:group.meta.groupId},title:group.locales[locale.value].title})
    for(const item of collection.items)if(item.locales[locale.value])result.push({target:{ref:'item',id:item.meta.itemId},title:item.locales[locale.value].title})
  }
  return result
})
const originalLanguage=computed(()=>{
  if(!model.value||!content.value||locale.value===model.value.settings.defaultLocale)return null
  const path=pathsFor(model.value,content.value!)
  const defaultLocale=model.value.settings.defaultLocale
  const page=model.value.pages.find(page=>page.directoryPath===path.directory)
  if(page)return page.locales[defaultLocale]
  const collection=currentCollection.value
  if(content.value?.ref==='collection')return collection?.indexLocales[defaultLocale]
  if(content.value?.ref==='group')return collection?.groups.find(group=>group.directoryPath===path.directory)?.locales[defaultLocale]
  return collection?.items.find(item=>item.directoryPath===path.directory)?.locales[defaultLocale]
})
const seoIssues=computed(()=>content.value?inspectSeo(renderedHtml.value,content.value.locale.seo.title,content.value.locale.seo.description,model.value?.pages.filter(page=>page.meta.pageId!==currentId.value).map(page=>page.locales[locale.value]?.seo.title).filter((title):title is string=>Boolean(title))??[]):[])
const fieldIssues=computed(()=>{
  const issues:string[]=[]
  const ids=new Set<string>()
  function inspect(blocks:BlockNode[]):void{for(const block of blocks){
    const definition=definitions.value.find(definition=>definition.type===block.type)
    if(!definition||ids.has(block.id)){issues.push('部分区域需要重新选择内容类型。');continue}
    ids.add(block.id)
    if(validateBlockProps(block.type,definition.fields,block.props).length)issues.push('部分内容尚未填写完整，请检查右侧属性。')
    if(block.children.some(child=>!definition.accepts.includes(child.type)))issues.push('这个区域不能放入所选内容，请调整内容层级。')
    inspect(block.children)
  }}
  if(content.value)inspect(content.value.locale.blocks)
  if(content.value){
    const value=content.value
    if(value.ref==='item'&&currentCollection.value&&validateCollectionFields(currentCollection.value.definition.fields,value.meta.fields,value.locale.fields).length)issues.push('内容类型的必填项目或填写格式需要完善，请检查页面设置。')
    const metaSchema=value.ref==='collection'?'collection':`${value.ref}-meta`
    const localeSchema=value.ref==='collection'?'collection-index-locale':`${value.ref}-locale`
    if(!validateSchema(metaSchema as Parameters<typeof validateSchema>[0],value.meta).valid||!validateSchema(localeSchema as Parameters<typeof validateSchema>[0],value.locale,value.ref==='page'?{pageRole:value.meta.role as never}:{}).valid)issues.push('页面设置尚未填写完整，请检查地址、内容和分组。')
  }
  return [...new Set(issues)]
})
const saveStatus=computed(()=>saving.value?'正在保存…':conflict.value?'需要核对其他成员的更新':dirty.value?'有未保存修改':'已保存')
const translationStatus=computed(()=>locale.value===model.value?.settings.defaultLocale?'当前为原文':!content.value?.locale.sourceHash?'尚未记录翻译来源':content.value.locale.sourceHash===defaultSourceHash.value?'翻译已更新':'原文已有修改')
watch(originalLanguage,async original=>{defaultSourceHash.value='';if(!original)return;const epoch=loadingEpoch;const hash=await translationSourceHash(original as unknown as Record<string,unknown>);if(epoch===loadingEpoch)defaultSourceHash.value=hash})

function pathsFor(site:SiteModel,value:EditorContent):{meta:string;directory:string}{
  const id=String(value.meta[`${value.ref}Id`])
  if(value.ref==='page'){const page=site.pages.find(page=>page.meta.pageId===id);if(!page)throw new Error('内容不存在');return {meta:`${page.directoryPath}/page.json`,directory:page.directoryPath}}
  const collection=site.collections.find(collection=>collection.definition.collectionId===(value.ref==='collection'?id:value.collectionId))
  if(!collection)throw new Error('内容不存在')
  if(value.ref==='collection')return {meta:collection.definitionPath,directory:`source/collections/${id}/index`}
  const object=value.ref==='group'?collection.groups.find(group=>group.meta.groupId===id):collection.items.find(item=>item.meta.itemId===id)
  if(!object)throw new Error('内容不存在')
  return {meta:`${object.directoryPath}/${value.ref}.json`,directory:object.directoryPath}
}

function commit(next:EditorContent):void{
  if(!history)return
  content.value=history.apply(next)
  historyVersion.value++
  message.value=''
}
function edit(change:(next:EditorContent)=>void):void{
  if(!content.value||generating.value)return
  const next=JSON.parse(JSON.stringify(content.value)) as EditorContent
  change(next)
  commit(next)
}
function updateLocale(key:string,value:unknown):void{edit(next=>{next.locale[key]=value})}
function updateMeta(key:string,value:unknown):void{edit(next=>{next.meta[key]=value})}
function updateProps(key:string,value:unknown):void{if(selectedId.value)edit(next=>changeBlock(next.locale.blocks,selectedId.value,block=>{block.props[key]=value}))}
function updateSeo(key:string,value:unknown):void{edit(next=>{next.locale.seo={...next.locale.seo,[key]:value}})}
function updateCustom(field:FieldDefinition,value:unknown):void{edit(next=>{const target=field.translatable?next.locale:next.meta;target.fields={...(target.fields as Record<string,unknown>??{}),[field.key]:value}})}
async function changeLanguage(code:string):Promise<void>{await router.push({query:{...route.query,locale:code}})}
function undo():void{if(history){content.value=history.undo();historyVersion.value++}}
function redo():void{if(history){content.value=history.redo();historyVersion.value++}}
function addBlock(definition:RegisteredBlock):void{
  const block:BlockNode={id:crypto.randomUUID(),type:definition.type,props:JSON.parse(JSON.stringify(definition.preview)),children:[]}
  for(const field of definition.fields){
    const value=block.props[field.key]
    if(field.type==='media'&&value&&typeof value==='object'&&!model.value?.media.some(media=>media.mediaId===(value as {mediaId:string}).mediaId))delete block.props[field.key]
    if(field.type==='mediaList'&&Array.isArray(value))block.props[field.key]=value.filter(item=>model.value?.media.some(media=>media.mediaId===item.mediaId))
  }
  edit(next=>{if(selected.value&&selectedDefinition.value?.accepts.includes(block.type))changeBlock(next.locale.blocks,selectedId.value,parent=>parent.children.push(block));else next.locale.blocks.push(block)})
  selectedId.value=block.id
}
function duplicateSelected():void{
  if(!selected.value)return
  const duplicate=freshBlock(selected.value)
  edit(next=>{const walk=(blocks:BlockNode[]):boolean=>{const index=blocks.findIndex(block=>block.id===selectedId.value);if(index>=0){blocks.splice(index+1,0,duplicate);return true}return blocks.some(block=>walk(block.children))};walk(next.locale.blocks)})
  selectedId.value=duplicate.id
}
function deleteSelected():void{edit(next=>{removeBlock(next.locale.blocks,selectedId.value)});selectedId.value=''}

async function refreshAccess():Promise<void>{
  const epoch=loadingEpoch
  const next=await api<ResourceAccess>('POST',`/api/drafts/${encodeURIComponent(draftId.value)}/resource-access`)
  if(epoch!==loadingEpoch)return
  access.value=next
  if(accessTimer)clearTimeout(accessTimer)
  accessTimer=setTimeout(()=>{void refreshAccess().catch(()=>{error.value='图片授权已过期，请重新打开页面。'})},editorResourceRefreshDelay(next))
}
function resourceFailed(token:string):void{if(token===access.value?.token)void refreshAccess().catch(()=>{error.value='图片资料暂时无法读取，请重新加载内容。'})}

async function load():Promise<void>{
  const epoch=++loadingEpoch
  streamController?.abort()
  generating.value=false
  loading.value=true
  saving.value=false
  renderingEpoch++
  content.value=undefined
  model.value=undefined
  history=undefined
  missingTranslationSource.value=undefined
  error.value=''
  selectedId.value=''
  aiBlocks.value=null
  conflict.value=false
  try{
    const selectedDraft=requireSelectedDraftId()
    const routeDraft=String(route.params.draftId??selectedDraft)
    if(routeDraft!==selectedDraft)throw new Error('请切换到当前内容所属的网站。')
    draftId.value=selectedDraft
    clearEditorResources(selectedDraft)
    sourceReader=createApiSourceReader(selectedDraft)
    const targetLocale=String(route.query.locale??'en')
    const [documentResult,siteResult]=await Promise.allSettled([api<EditorDocument>('GET',`/api/drafts/${encodeURIComponent(selectedDraft)}/content/${currentRef.value}/${encodeURIComponent(currentId.value)}?locale=${encodeURIComponent(targetLocale)}`),loadSiteModel(sourceReader)])
    if(epoch!==loadingEpoch)return
    if(siteResult.status==='rejected')throw siteResult.reason
    const site=siteResult.value
    const plugins=Object.entries(site.plugins.plugins).filter(([,plugin])=>plugin.enabled).map(([id])=>id)
    const registry=await loadBlockRegistry(sourceReader,{themeId:site.appearance.themeId,enabledPluginIds:plugins})
    const theme=JSON.parse(await sourceReader.readText(`themes/${site.appearance.themeId}/theme.json`)) as {templates?:Array<{id:string;name:string}>}
    if(epoch!==loadingEpoch)return
    model.value=site
    definitions.value=registry.list()
    templates.value=[{id:'page',name:'默认模板'},...(theme.templates??[])]
    await refreshAccess()
    if(documentResult.status==='rejected'){
      if(documentResult.reason instanceof ApiError&&documentResult.reason.status===404&&targetLocale!==site.settings.defaultLocale){
        const original=await api<EditorDocument>('GET',`/api/drafts/${encodeURIComponent(selectedDraft)}/content/${currentRef.value}/${encodeURIComponent(currentId.value)}?locale=${encodeURIComponent(site.settings.defaultLocale)}`)
        if(epoch===loadingEpoch)missingTranslationSource.value=original
        return
      }
      throw documentResult.reason
    }
    const document=documentResult.value
    content.value=document.content
    revision.value=document.revision
    history=new EditorHistory(document.content)
    historyVersion.value++
    saved.value=editableSnapshot(document.content)
    await renderFrame()
  }catch(cause){if(epoch===loadingEpoch)error.value=cause instanceof ApiError&&cause.status===404?'这份内容暂时不存在，请返回内容列表。':'内容暂时无法打开，请确认网站选择后重试。'}
  finally{if(epoch===loadingEpoch)loading.value=false}
}

function createLanguageCopy():void{
  if(!missingTranslationSource.value)return
  const document=JSON.parse(JSON.stringify(missingTranslationSource.value)) as EditorDocument
  document.content.locale.locale=String(route.query.locale)
  document.content.locale.sourceHash=null
  content.value=document.content
  revision.value=document.revision
  history=new EditorHistory(document.content)
  historyVersion.value++
  saved.value=''
  missingTranslationSource.value=undefined
  message.value='已复制原文，请编辑这个语言的内容并保存。'
}

async function translateLanguage():Promise<void>{
  if(!model.value||saving.value||generating.value)return
  if(dirty.value&&!await save())return
  const epoch=loadingEpoch
  generating.value=true
  error.value=''
  streamController=new AbortController()
  try{
    const response=await api<{job:{jobId:string}}>('POST','/api/jobs/translate_node',{draftId:draftId.value,locale:model.value.settings.defaultLocale,target:{ref:currentRef.value,id:currentId.value},targetLocale:String(route.query.locale??locale.value)},{headers:{'Idempotency-Key':crypto.randomUUID()}})
    let failed=false
    await watchEditorJob(response.job.jobId,event=>{if(event.type==='job_failed')failed=true},streamController.signal)
    if(epoch!==loadingEpoch)return
    if(failed)throw new Error('翻译失败')
    await load()
    message.value='翻译内容已保存，请核对文字。'
  }catch{if(epoch===loadingEpoch&&!streamController.signal.aborted)error.value='翻译暂时无法完成，请检查模型连接设置后重试。'}
  finally{if(epoch===loadingEpoch)generating.value=false}
}

async function renderFrame():Promise<void>{
  if(!content.value||!model.value||!sourceReader||!access.value)return
  const epoch=++renderingEpoch
  const value=JSON.parse(JSON.stringify(content.value)) as EditorContent
  if(aiBlocks.value)value.locale.blocks=aiBlocks.value
  try{
    const paths=pathsFor(model.value,value)
    const reader=createOverlaySourceReader(sourceReader,new Map([[paths.meta,JSON.stringify(value.meta)],[`${paths.directory}/${value.locale.locale}.json`,JSON.stringify(value.locale)]]))
    const site=await loadSiteModel(reader)
    const target=value.ref==='page'?{kind:'page' as const,pageId:currentId.value}:value.ref==='collection'?{kind:'collection' as const,collectionId:currentId.value}:value.ref==='group'?{kind:'group' as const,collectionId:value.collectionId!,groupId:currentId.value}:{kind:'item' as const,collectionId:value.collectionId!,itemId:currentId.value}
    const html=await renderTarget(site,target,value.locale.locale,{reader,mode:'canvas'})
    const document=await createCanvasDocument(html,reader,access.value,site.media,selectedId.value)
    if(epoch!==renderingEpoch)return
    renderedHtml.value=html
    frameHtml.value=document
    renderError.value=''
  }catch{if(epoch===renderingEpoch)renderError.value='部分内容尚未填写完整，预览会在补充后更新。'}
}
watch([content,access,aiBlocks],()=>{void renderFrame()},{deep:true})
watch(selectedId,id=>frame.value?.contentWindow?.postMessage({type:'olps-editor-highlight',blockId:id},'*'))
watch(()=>[selectedDraftIdState.value,route.params.ref,route.params.id,route.params.pageId,route.query.locale],load,{immediate:true})

async function save():Promise<boolean>{
  if(!content.value||saving.value||generating.value||fieldIssues.value.length)return false
  const epoch=loadingEpoch
  const sent=JSON.parse(JSON.stringify(content.value)) as EditorContent
  saving.value=true
  error.value=''
  message.value=''
  try{
    const result=await api<EditorDocument>('PUT',`/api/drafts/${encodeURIComponent(draftId.value)}/content/${currentRef.value}/${encodeURIComponent(currentId.value)}?locale=${encodeURIComponent(locale.value)}`,sent,{headers:{'If-Match':`"${revision.value}"`}})
    if(epoch!==loadingEpoch)return false
    revision.value=result.revision
    saved.value=editableSnapshot(result.content)
    const next=JSON.parse(JSON.stringify(content.value)) as EditorContent
    applySavedPageMetadata(next,result.content)
    content.value=history!.replaceCurrent(next)
    historyVersion.value++
    conflict.value=false
    message.value='内容已保存。'
    return true
  }catch(cause){if(epoch===loadingEpoch){conflict.value=cause instanceof ApiError&&cause.code==='REVISION_CONFLICT';error.value=conflict.value?'其他成员已经修改了这份内容。你的输入已保留，请重新加载后核对。':'保存失败，当前输入已保留，请检查内容后重试。'}return false}
  finally{if(epoch===loadingEpoch)saving.value=false}
}

async function preview():Promise<void>{
  if(dirty.value&&!await save())return
  try{const result=await api<{previewUrl:string}>('POST',`/api/drafts/${encodeURIComponent(draftId.value)}/preview`,{locale:locale.value,target:{ref:currentRef.value,id:currentId.value},returnPath:route.fullPath});window.open(result.previewUrl,'_blank','noopener')}
  catch{error.value='暂时无法打开预览，请保存内容后重试。'}
}

async function upload(file:File):Promise<void>{
  try{
    const body=new FormData();body.set('file',file)
    const result=await api<{media:SiteModel['media'][number]}>('POST',`/api/drafts/${encodeURIComponent(draftId.value)}/media`,body)
    if(model.value)model.value.media.push(result.media)
    sourceReader=createApiSourceReader(draftId.value)
    await renderFrame()
    message.value='图片已上传，可以在图片库中选择。'
  }catch{error.value='图片上传失败，请检查图片类型与大小。'}
}

async function generate(blockOnly:boolean):Promise<void>{
  if(saving.value||generating.value)return
  if(!instruction.value.trim()||(blockOnly&&!selectedId.value))return
  if(dirty.value&&!await save())return
  const epoch=loadingEpoch
  generating.value=true
  error.value=''
  streamController=new AbortController()
  try{
    const type=blockOnly?'rewrite_block':'revise_node'
    const response=await api<{job:{jobId:string}}>('POST',`/api/jobs/${type}`,{draftId:draftId.value,locale:locale.value,target:{ref:currentRef.value,id:currentId.value},instruction:instruction.value,...(blockOnly?{blockId:selectedId.value}:{})},{headers:{'Idempotency-Key':crypto.randomUUID()}})
    let failed=false
    await watchEditorJob(response.job.jobId,event=>{
      if(epoch!==loadingEpoch)return
      if(event.type==='outline_completed')aiBlocks.value=[]
      if(event.type==='block_completed')aiBlocks.value=[...(aiBlocks.value??[]),{id:String(event.payload.blockId),type:String(event.payload.blockType),props:event.payload.props as Record<string,unknown>,children:[]}]
      if(event.type==='job_failed')failed=true
    },streamController.signal)
    if(epoch!==loadingEpoch)return
    if(failed)throw new Error('生成失败')
    await load()
    message.value='内容已更新。'
  }catch(cause){if(epoch===loadingEpoch&&!streamController.signal.aborted)error.value='内容生成失败，原有内容已保留，请检查连接设置后重试。'}
  finally{if(epoch===loadingEpoch){generating.value=false;aiBlocks.value=null}}
}

function confirmLeave():boolean{return !(dirty.value||saving.value||generating.value)||window.confirm('当前内容尚未保存完成，确认离开？')}
function languageName(code:string):string{return new Intl.DisplayNames(['zh-CN'],{type:'language'}).of(code)??code}
function reload():void{if(!dirty.value||window.confirm('重新加载会替换当前输入，确认继续？'))void load()}
onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate(confirmLeave)
function beforeUnload(event:BeforeUnloadEvent):void{protectPageUnload(event,dirty.value||saving.value||generating.value)}
window.addEventListener('beforeunload',beforeUnload)
function messageFromFrame(event:MessageEvent):void{
  if(event.source!==frame.value?.contentWindow||!event.data||typeof event.data!=='object')return
  if(event.data.type==='olps-editor-select'&&typeof event.data.blockId==='string')selectedId.value=event.data.blockId
  if(event.data.type==='olps-editor-heading'&&typeof event.data.blockId==='string'&&typeof event.data.value==='string'){selectedId.value=event.data.blockId;updateProps('text',event.data.value)}
}
window.addEventListener('message',messageFromFrame)
onBeforeUnmount(()=>{loadingEpoch++;renderingEpoch++;streamController?.abort();if(accessTimer)clearTimeout(accessTimer);window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('message',messageFromFrame)})
</script>

<template>
  <el-alert v-if="loading" title="正在打开编辑器…" type="info" show-icon :closable="false" />
  <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
  <section v-if="missingTranslationSource" class="panel">
    <h1>填写这个语言的内容</h1>
    <p>这个语言的内容尚未创建，可以复制原文后手动编辑，或使用 AI 翻译。</p>
    <div class="row">
      <el-button type="primary" :disabled="generating" @click="createLanguageCopy">复制原文并编辑</el-button>
      <el-button :loading="generating" @click="translateLanguage">翻译这个语言</el-button>
    </div>
    <el-alert v-if="generating" title="正在翻译内容…" type="info" show-icon :closable="false" class="page-alert" />
  </section>
  <div v-if="content&&model&&access" class="cms-editor">
    <header class="editor-toolbar">
      <h1>编辑内容</h1>
      <span class="toolbar-label">语言</span>
      <el-select :model-value="locale" :disabled="saving||generating" style="width:140px" @change="changeLanguage">
        <el-option v-for="language in model.settings.locales" :key="language.code" :value="language.code" :label="languageName(language.code)" />
      </el-select>
      <span class="toolbar-label">画布宽度</span>
      <el-select v-model="width" style="width:110px">
        <el-option :value="1280" label="电脑" />
        <el-option :value="768" label="平板" />
        <el-option :value="375" label="手机" />
      </el-select>
      <span>{{ translationStatus }}</span>
      <el-button v-if="locale!==model.settings.defaultLocale" :disabled="saving||generating" @click="translateLanguage">翻译为当前语言</el-button>
      <el-button :disabled="!canUndo||generating" @click="undo">撤销</el-button>
      <el-button :disabled="!canRedo||generating" @click="redo">重做</el-button>
      <span role="status" data-cms-save-status>{{ saveStatus }}</span>
      <el-button type="primary" :loading="saving" :disabled="generating||Boolean(fieldIssues.length)" @click="save">保存内容</el-button>
      <el-button :disabled="saving||generating" @click="preview">打开预览</el-button>
    </header>
    <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="renderError" :title="renderError" type="warning" show-icon :closable="false" class="page-alert" />
    <el-alert v-for="issue in fieldIssues" :key="issue" :title="issue" type="error" show-icon :closable="false" class="page-alert" />
    <el-button v-if="conflict" type="warning" @click="reload">重新加载内容</el-button>
    <div class="editor-panels">
      <aside class="editor-outline">
        <el-button text type="primary" :aria-expanded="outlineOpen" @click="outlineOpen=!outlineOpen">内容目录与区块库</el-button>
        <template v-if="outlineOpen">
          <h2>内容目录</h2>
          <BlockOutline :blocks="content.locale.blocks" :definitions="definitions" :selected-id="selectedId" @update="updateLocale('blocks',$event)" @select="selectedId=$event" />
          <h2>添加内容</h2>
          <div class="block-library">
            <el-button
              v-for="definition in definitions"
              :key="definition.type"
              class="block-library-item"
              :disabled="generating"
              @click="addBlock(definition)"
            >{{ ({'core/heading':'标题','core/text':'文字','core/image':'图片','core/video':'视频','core/button':'按钮','core/columns':'多栏内容','core/html':'自定义内容','core/faq':'常见问题','core/collection-list':'内容列表'} as Record<string,string>)[definition.type]??definition.name }}</el-button>
          </div>
        </template>
      </aside>
      <main class="editor-canvas-area">
        <div class="editor-canvas" :style="{width:width+'px'}">
          <iframe ref="frame" :srcdoc="frameHtml" sandbox="allow-scripts" title="内容编辑画布" :width="width" />
        </div>
      </main>
      <aside class="editor-properties">
        <el-button text type="primary" :aria-expanded="settingsOpen" @click="settingsOpen=!settingsOpen">内容属性</el-button>
        <template v-if="settingsOpen">
          <el-form v-if="selected&&selectedDefinition" label-position="top">
            <h2>区域属性</h2>
            <el-button @click="selectedId=''">查看页面设置</el-button>
            <FieldControl
              v-for="field in selectedDefinition.fields"
              :key="field.key"
              :field="field"
              :model-value="selected.props[field.key]"
              :media="model.media"
              :access="access"
              :locale="locale"
              :links="links"
              @update:model-value="updateProps(field.key,$event)"
              @upload="upload"
              @resource-error="resourceFailed"
            />
            <div class="editor-actions">
              <el-button @click="duplicateSelected">复制区域</el-button>
              <el-button type="danger" @click="deleteSelected">删除区域</el-button>
            </div>
          </el-form>
          <el-form v-else label-position="top">
            <h2>页面设置</h2>
            <el-form-item label="标题">
              <el-input :model-value="content.locale.title" @input="updateLocale('title',$event)" />
            </el-form-item>
            <el-form-item v-if="'slug'in content.locale&&content.meta.role!=='home'&&content.meta.role!=='not-found'" label="页面地址">
              <el-input :model-value="content.locale.slug" @input="updateLocale('slug',$event)" />
            </el-form-item>
            <el-form-item label="摘要">
              <el-input type="textarea" :rows="3" :model-value="content.locale.summary" @input="updateLocale('summary',$event)" />
            </el-form-item>
            <el-form-item label="发布范围">
              <el-select :model-value="content.meta.status" style="width:100%" @change="updateMeta('status',$event)">
                <el-option value="draft" label="仅在预览显示" />
                <el-option value="published" label="包含在发布中" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="content.ref==='page'" label="页面模板">
              <el-select :model-value="content.meta.template" style="width:100%" @change="updateMeta('template',$event)">
                <el-option v-for="template in templates" :key="template.id" :value="template.id" :label="template.name" />
              </el-select>
            </el-form-item>
            <MediaPicker
              label="封面图片"
              :model-value="content.locale.cover"
              :media="model.media"
              :access="access"
              :locale="locale"
              @update:model-value="updateLocale('cover',$event)"
              @upload="upload"
              @resource-error="resourceFailed"
            />
            <template v-if="content.ref==='group'&&currentCollection">
              <el-form-item label="分组层级">
                <el-select :model-value="content.meta.levelId" style="width:100%" @change="updateMeta('levelId',$event)">
                  <el-option v-for="level in currentCollection.definition.levels" :key="level.levelId" :value="level.levelId" :label="level.name" />
                </el-select>
              </el-form-item>
              <el-form-item label="上级分组">
                <el-select :model-value="content.meta.parentGroupId??''" style="width:100%" @change="updateMeta('parentGroupId',$event||null)">
                  <el-option value="" label="没有上级分组" />
                  <el-option
                    v-for="group in currentCollection.groups.filter(group=>group.meta.groupId!==currentId)"
                    :key="group.meta.groupId"
                    :value="group.meta.groupId"
                    :label="group.locales[locale]?.title??'未填写名称的分组'"
                  />
                </el-select>
              </el-form-item>
            </template>
            <template v-if="content.ref==='item'&&currentCollection">
              <el-form-item label="所属分组">
                <el-select
                  :model-value="content.meta.groupIds"
                  multiple
                  style="width:100%"
                  @change="updateMeta('groupIds',$event)"
                >
                  <el-option
                    v-for="group in currentCollection.groups"
                    :key="group.meta.groupId"
                    :value="group.meta.groupId"
                    :label="group.locales[locale]?.title??'未填写名称的分组'"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="主分组">
                <el-select :model-value="content.meta.primaryGroupId??''" style="width:100%" @change="updateMeta('primaryGroupId',$event||null)">
                  <el-option value="" label="不选择" />
                  <el-option
                    v-for="group in currentCollection.groups.filter(group=>(content!.meta.groupIds as string[]).includes(group.meta.groupId))"
                    :key="group.meta.groupId"
                    :value="group.meta.groupId"
                    :label="group.locales[locale]?.title??'未填写名称的分组'"
                  />
                </el-select>
              </el-form-item>
            </template>
            <CmsFieldEditor
              v-for="field in customFields"
              :key="field.key"
              :field="field"
              :model-value="((field.translatable?content.locale.fields:content.meta.fields) as Record<string,unknown>??{})[field.key]"
              :draft-id="draftId"
              :locale="locale"
              @update:model-value="updateCustom(field,$event)"
            />
            <details>
              <summary>搜索结果设置</summary>
              <el-form-item label="搜索结果标题">
                <el-input :model-value="content.locale.seo.title" @input="updateSeo('title',$event)" />
              </el-form-item>
              <el-form-item label="搜索结果摘要">
                <el-input type="textarea" :rows="3" :model-value="content.locale.seo.description" @input="updateSeo('description',$event)" />
              </el-form-item>
              <MediaPicker
                label="分享图片"
                :model-value="content.locale.seo.ogImage"
                :media="model.media"
                :access="access"
                :locale="locale"
                @update:model-value="updateSeo('ogImage',$event)"
                @upload="upload"
                @resource-error="resourceFailed"
              />
            </details>
          </el-form>
          <details v-if="originalLanguage">
            <summary>默认语言参照</summary>
            <h3>{{ originalLanguage.title }}</h3>
            <p>{{ originalLanguage.summary }}</p>
          </details>
          <details>
            <summary>搜索检查</summary>
            <ul v-if="seoIssues.length"><li v-for="issue in seoIssues" :key="issue">{{ issue }}</li></ul>
            <p v-else>当前检查项目全部通过。</p>
          </details>
          <section class="editor-ai">
            <h2>用 AI 修改</h2>
            <el-form-item label="修改要求">
              <el-input v-model="instruction" type="textarea" :rows="3" placeholder="说明希望修改的内容" />
            </el-form-item>
            <div class="row">
              <el-button type="primary" :disabled="generating||saving||!instruction.trim()" @click="generate(false)">修改整页内容</el-button>
              <el-button v-if="selected" :disabled="generating||saving||!instruction.trim()" @click="generate(true)">重写这个区域</el-button>
            </div>
            <el-alert v-if="generating" title="正在生成内容，完成的区域会依次显示…" type="info" show-icon :closable="false" class="page-alert" />
          </section>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.cms-editor{display:grid;gap:.65rem}
.page-alert{margin:8px 0}
.row{display:flex;flex-wrap:wrap;gap:8px}
.editor-toolbar{
  display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;padding:.7rem;
  background:var(--el-bg-color);border:1px solid var(--el-border-color);
  border-radius:var(--el-border-radius-base);position:sticky;top:0;z-index:3
}
.editor-toolbar h1{font-size:1.15rem;margin:0 auto 0 0}
.toolbar-label{font-size:13px;color:var(--el-text-color-regular)}
.editor-panels{display:grid;grid-template-columns:210px minmax(0,1fr) 300px;gap:.7rem;align-items:start}
.editor-outline,.editor-properties{
  background:var(--el-bg-color);border:1px solid var(--el-border-color);
  border-radius:var(--el-border-radius-base);padding:.75rem;
  max-height:calc(100vh - 155px);overflow:auto;position:sticky;top:80px
}
.editor-outline h2,.editor-properties h2{font-size:1rem}
.block-library{display:grid;gap:.3rem}
.block-library-item{justify-content:flex-start}
.editor-canvas-area{min-width:0;overflow:auto;background:var(--el-fill-color-light);padding:12px;min-height:600px}
.editor-canvas{margin:0 auto;background:var(--el-bg-color);box-shadow:var(--el-box-shadow-lighter)}
.editor-canvas iframe{display:block;border:0;height:950px;background:var(--el-bg-color)}
.editor-properties details{margin:.8rem 0}
.editor-properties summary{cursor:pointer;font-weight:600}
.editor-actions{display:flex;gap:.4rem;margin:1rem 0}
.editor-ai{border-top:1px solid var(--el-border-color);margin-top:1rem;padding-top:.5rem}
@media(max-width:1100px){
  .editor-panels{grid-template-columns:170px minmax(0,1fr)}
  .editor-properties{grid-column:1/-1;max-height:none;position:static}
}
@media(max-width:680px){
  .editor-panels{grid-template-columns:minmax(0,1fr)}
  .editor-outline{position:static;max-height:220px}
  .editor-properties{grid-column:auto}
  .editor-toolbar{position:static}
  .editor-canvas-area{padding:4px}
}
</style>

<script setup lang="ts">
import { computed,onUnmounted,ref,watch } from 'vue'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import { api,getAccessToken } from '../api'
import { selectedSiteIdState,selectedDraftIdState } from '../workspaceSession'
import { contentLocale } from '../cms-state'
import { generationLabels,type GenerationNode,type GenerationType } from '../cms-generation'
import CmsGenerationTree from '../components/CmsGenerationTree.vue'

type Content={ref:'page'|'collection'|'group'|'item';meta:Record<string,unknown>;locale:{title:string;blocks?:Array<{id:string;type:string;props:Record<string,unknown>;children:unknown[]}>}}
type Job={jobId:string;type:GenerationType;status:string;result?:{nodes?:GenerationNode[];nodeIds?:string[]};error?:unknown}
type JobEvent={eventId:number;type:string;payload:Record<string,unknown>}
const operation=ref<GenerationType>('propose_site_structure'),instruction=ref(''),title=ref(''),targetLocale=ref('zh-CN'),scope=ref<'all'|'outdated'>('all')
const contents=ref<Content[]>([]),documents=ref<Array<{documentId:string;title:string}>>([]),knowledgeIds=ref<string[]>([]),nodes=ref<GenerationNode[]>([])
const selectedTarget=ref(''),selectedBlock=ref(''),job=ref<Job|null>(null),error=ref(''),connection=ref(''),sending=ref(false),completedAreas=ref(0)
let controller:AbortController|undefined
let generation=0
const active=computed(()=>sending.value || !!job.value && !['completed','failed'].includes(job.value.status))
const targetRequired=computed(()=>['revise_node','rewrite_block','translate_node','generate_seo'].includes(operation.value))
const translating=computed(()=>operation.value.startsWith('translate_'))
function id(content:Content):string{return String(content.meta[`${content.ref}Id`])}
const target=computed(()=>contents.value.find(content=>`${content.ref}:${id(content)}`===selectedTarget.value))
const collections=computed(()=>contents.value.filter(item=>item.ref==='collection').map(item=>({id:id(item),title:item.locale.title})))
const blockLabels:Record<string,string>={'core/html':'正文区域','core/text':'文字区域','core/image':'图片区域','core/columns':'分栏区域','core/collection-list':'内容列表','plugin/inquiry-form/form':'询盘表单'}
function businessError(value:unknown):string{
  if(typeof value==='object' && value && 'error' in value)return String(value.error)
  if(typeof value==='string'){try{const parsed=JSON.parse(value) as {error?:unknown};if(parsed.error)return String(parsed.error)}catch(cause){if(!(cause instanceof SyntaxError))throw cause}return value}
  return '生成没有完成，请查看网站与模型设置。'
}
async function load(){
  const current=++generation;controller?.abort();error.value='';job.value=null;completedAreas.value=0;connection.value=''
  if(!selectedSiteIdState.value || !selectedDraftIdState.value){contents.value=[];documents.value=[];return}
  try{
    const base=`/api/drafts/${encodeURIComponent(selectedDraftIdState.value)}`
    const locale=encodeURIComponent(contentLocale.value)
    const [pages,lists,knowledge]=await Promise.all([api<{pages:Content[]}>('GET',`${base}/pages?locale=${locale}&limit=100`),api<{collections:Content[]}>('GET',`${base}/collections?locale=${locale}&limit=100`),api<{documents:Array<{documentId:string;title:string}>}>('GET',`/api/sites/${encodeURIComponent(selectedSiteIdState.value)}/knowledge-base/documents`)])
    const extra=await Promise.all(lists.collections.flatMap(collection=>['groups','items'].map(async plural=>{const result=await api<Record<string,Content[]>>('GET',`${base}/collections/${id(collection)}/${plural}?locale=${locale}&limit=100`);return result[plural]!})))
    if(current!==generation)return
    contents.value=[...pages.pages,...lists.collections,...extra.flat()];documents.value=knowledge.documents
    if(!contents.value.some(item=>`${item.ref}:${id(item)}`===selectedTarget.value))selectedTarget.value=contents.value[0]?`${contents.value[0].ref}:${id(contents.value[0])}`:''
    const pending=localStorage.getItem(`olps_generation_${selectedDraftIdState.value}`)
    if(pending){job.value=(await api<{job:Job}>('GET',`/api/jobs/${pending}`)).job;if(job.value.status==='completed' && job.value.result?.nodes)nodes.value=job.value.result.nodes;if(!['completed','failed'].includes(job.value.status))void monitor(pending,current);if(job.value.status==='failed')error.value=businessError(job.value.error)}
  }catch(cause){if(current===generation)error.value=cause instanceof Error?cause.message:String(cause)}
}
watch([selectedSiteIdState,selectedDraftIdState,contentLocale],()=>{nodes.value=[];knowledgeIds.value=[];void load()},{immediate:true})
watch(selectedTarget,()=>{selectedBlock.value=target.value?.locale.blocks?.[0]?.id??''})
onUnmounted(()=>{generation++;controller?.abort()})
async function monitor(jobId:string,current:number){
  controller?.abort();const abort=new AbortController();controller=abort
  const saved=JSON.parse(localStorage.getItem(`olps_generation_progress_${jobId}`)??'{"after":0,"areas":0}') as {after:number;areas:number}
  let after=saved.after;completedAreas.value=saved.areas
  while(!abort.signal.aborted && current===generation){
    try{
      const response=await fetch(`/api/jobs/${jobId}/events`,{headers:{Authorization:`Bearer ${getAccessToken()}`,'Last-Event-ID':String(after)},signal:abort.signal})
      if(!response.ok)throw new Error((await response.json() as {error:string}).error)
      if(!response.body)throw new Error('生成进度连接没有返回内容')
      connection.value='正在接收生成进度'
      const reader=response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream()).getReader()
      try{
        while(true){
          const item=await reader.read();if(item.done)break
          const event=JSON.parse(item.value.data) as JobEvent
          if(event.eventId<=after)continue
          after=event.eventId
          if(event.type==='block_completed')completedAreas.value++
          if(event.type==='node_failed' || event.type==='job_failed')error.value=businessError(event.payload)
          localStorage.setItem(`olps_generation_progress_${jobId}`,JSON.stringify({after,areas:completedAreas.value}))
        }
      }finally{reader.releaseLock()}
    }catch(cause){
      if(abort.signal.aborted || current!==generation)return
      connection.value=cause instanceof Error?`进度连接中断：${cause.message}`:'进度连接中断'
    }
    if(current!==generation || abort.signal.aborted)return
    try{job.value=(await api<{job:Job}>('GET',`/api/jobs/${jobId}`)).job}catch(cause){error.value=cause instanceof Error?cause.message:String(cause);return}
    if(['completed','failed'].includes(job.value.status)){
      connection.value=''
      if(job.value.result?.nodes)nodes.value=job.value.result.nodes
      if(job.value.status==='failed')error.value=businessError(job.value.error)
      if(job.value.status==='completed'){
        const completed=completedAreas.value
        await load()
        if(job.value?.jobId===jobId)completedAreas.value=completed
      }
      return
    }
    await new Promise(resolve=>setTimeout(resolve,1000))
  }
}
function newNode():GenerationNode{return{nodeId:crypto.randomUUID(),ref:'page',title:title.value||'新页面',requirements:instruction.value,children:[]}}
async function start(){
  if(active.value || !selectedDraftIdState.value)return
  sending.value=true;error.value='';completedAreas.value=0
  try{
    const request:Record<string,unknown>={draftId:selectedDraftIdState.value,locale:contentLocale.value,instruction:instruction.value,knowledgeDocumentIds:knowledgeIds.value}
    if(targetRequired.value && target.value)request.target={ref:target.value.ref,id:id(target.value)}
    if(operation.value==='rewrite_block')request.blockId=selectedBlock.value
    if(translating.value){request.targetLocale=targetLocale.value;request.scope=scope.value}
    if(operation.value==='generate_node')request.node=newNode()
    if(operation.value==='generate_nodes')request.nodes=nodes.value
    const result=await api<{job:Job}>('POST',`/api/jobs/${operation.value}`,request,{headers:{'Idempotency-Key':crypto.randomUUID()}})
    job.value=result.job;localStorage.setItem(`olps_generation_${selectedDraftIdState.value}`,result.job.jobId)
    void monitor(result.job.jobId,generation)
  }catch(cause){error.value=cause instanceof Error?cause.message:String(cause)}finally{sending.value=false}
}
</script>
<template>
  <section class="panel"><h1>AI 内容助手</h1><p>选择本网站的资料和需要处理的内容，查看生成进度与结果。</p><p v-if="!selectedDraftIdState">请先选择网站的编辑版本。</p><p v-if="error" role="alert" class="error">{{ error }}</p>
    <form @submit.prevent="start"><fieldset :disabled="active"><label>处理内容<select v-model="operation"><option v-for="(label,key) in generationLabels" :key="key" :value="key">{{ label }}</option></select></label>
      <label v-if="targetRequired">选择已有内容<select v-model="selectedTarget" required><option v-for="content in contents" :key="`${content.ref}:${id(content)}`" :value="`${content.ref}:${id(content)}`">{{ content.locale.title }}</option></select></label>
      <label v-if="operation === 'rewrite_block'">选择内容区域<select v-model="selectedBlock" required><option v-for="block in target?.locale.blocks" :key="block.id" :value="block.id">{{ blockLabels[block.type] ?? '内容区域' }}</option></select></label>
      <label v-if="operation === 'generate_node'">新内容名称<input v-model="title" required /></label>
      <label>你的要求<textarea v-model="instruction" rows="5" placeholder="说明网站内容、读者和需要调整的地方" /></label>
      <div v-if="translating"><label>翻译为<select v-model="targetLocale"><option value="zh-CN">简体中文</option><option value="en">English</option></select></label><label v-if="operation === 'translate_site'">翻译范围<select v-model="scope"><option value="all">全部内容</option><option value="outdated">只翻译需要更新的内容</option></select></label></div>
      <fieldset><legend>使用的网站资料</legend><p v-if="!documents.length">网站知识库中还没有资料。</p><label v-for="document in documents" :key="document.documentId" class="knowledge-option"><input v-model="knowledgeIds" type="checkbox" :value="document.documentId" />{{ document.title }}</label></fieldset>
      <button :disabled="!selectedDraftIdState || operation === 'generate_nodes' && !nodes.length">{{ active ? '正在处理…' : '开始处理' }}</button>
    </fieldset></form>
    <section v-if="job" aria-label="内容生成进度"><h2>{{ generationLabels[job.type] }}</h2><p role="status">{{ job.status === 'completed' ? '处理完成' : job.status === 'failed' ? '处理没有完成' : '正在生成内容…' }}</p><p v-if="connection">{{ connection }}</p><p v-if="completedAreas">已完成 {{ completedAreas }} 个内容区域。</p><p v-if="job.status === 'completed' && job.result?.nodeIds?.length">已处理 {{ job.result.nodeIds.length }} 项内容。</p></section>
  </section>
  <section class="panel"><h2>网站内容结构</h2><p>可以调整名称、类型和要求，再选择「生成所选内容」。</p><CmsGenerationTree :nodes="nodes" :disabled="active" :collections="[...collections,...nodes.filter(node => node.ref === 'collection').map(node => ({id:node.nodeId,title:node.title}))]" /><button class="secondary" :disabled="active" @click="nodes.push(newNode())">添加内容</button></section>
</template>
<style scoped>fieldset{border:0;margin:0;padding:0}fieldset fieldset{border:1px solid var(--line);padding:1rem;margin:1rem 0}.knowledge-option{display:flex;gap:.5rem;align-items:center}.knowledge-option input{width:auto}</style>

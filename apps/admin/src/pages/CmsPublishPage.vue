<script setup lang="ts">
import { computed,onUnmounted,ref,watch } from 'vue'
import { api,getAccessToken } from '../api'
import { selectedSiteIdState,selectedDraftIdState } from '../workspaceSession'

type Target={targetId:string;name:string;type:string;enabled:boolean}
type Result={targetId:string;status:string;attempts:number;uploaded:number;removed:number;error:string|null}
type Notification={provider:string;status:string;error:string|null}
type Publication={recordId:string;status:string;kind:string;publicUrl:string|null;error:string|null;createdAt:string;targets:Result[];notifications:Notification[]}
const targets=ref<Target[]>([]),records=ref<Publication[]>([])
const historyCursor=ref<string|null>(null),hasMoreHistory=ref(false),loadingHistory=ref(false)
const busy=ref(false),error=ref(''),message=ref(''),question=ref<string|null>(null),answer=ref('')
let generation=0
const sitePath=computed(()=>`/api/sites/${encodeURIComponent(selectedSiteIdState.value)}`)
const draftPath=computed(()=>`${sitePath.value}/drafts/${encodeURIComponent(selectedDraftIdState.value)}`)
const labels:Record<string,string>={completed:'已完成',failed:'未完成',running:'正在进行',pending:'等待处理',blocked:'等待配置',clean:'已同步',dirty:'有新修改',merge_conflict:'需要确认',awaiting_user:'需要确认',validation_failed:'需要检查内容'}
function label(status:string):string{return labels[status]??'等待处理'}
async function readTargets(){
  const targets:Target[]=[];let cursor:string|null=null
  do{const locations:{targets:Target[];pageInfo:{nextCursor:string|null;hasNextPage:boolean}}=await api('GET',`${sitePath.value}/deploy-targets${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`);targets.push(...locations.targets);cursor=locations.pageInfo.nextCursor}while(cursor)
  return{targets}
}
async function load(){
  const current=++generation
  if(!selectedSiteIdState.value){records.value=[];targets.value=[];return}
  try{
    const [history,locations]=await Promise.all([api<{records:Publication[];pageInfo:{nextCursor:string|null;hasNextPage:boolean}}>('GET',`${sitePath.value}/publish-records`),readTargets()])
    if(current!==generation)return
    records.value=history.records;targets.value=locations.targets;historyCursor.value=history.pageInfo.nextCursor;hasMoreHistory.value=history.pageInfo.hasNextPage
    if(selectedDraftIdState.value){const state=await api<{question:string|null}>('GET',`${draftPath.value}/synchronization`);if(current===generation)question.value=state.question}
  }catch(cause){if(current===generation)error.value=cause instanceof Error?cause.message:String(cause)}
}
async function loadMoreHistory(){
  if(!historyCursor.value||loadingHistory.value)return
  const current=generation;loadingHistory.value=true
  try{const history=await api<{records:Publication[];pageInfo:{nextCursor:string|null;hasNextPage:boolean}}>('GET',`${sitePath.value}/publish-records?cursor=${encodeURIComponent(historyCursor.value)}`);if(current===generation){records.value.push(...history.records);historyCursor.value=history.pageInfo.nextCursor;hasMoreHistory.value=history.pageInfo.hasNextPage}}
  catch(cause){if(current===generation)error.value=cause instanceof Error?cause.message:String(cause)}finally{loadingHistory.value=false}
}
watch([selectedSiteIdState,selectedDraftIdState],()=>{error.value='';message.value='';question.value=null;void load()},{immediate:true})
const poll=setInterval(()=>{if(busy.value)void load()},1500)
onUnmounted(()=>{generation++;clearInterval(poll)})
async function perform(action:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';message.value='';try{await action()}catch(cause){error.value=cause instanceof Error?cause.message:String(cause)}finally{busy.value=false;await load()}}
async function publish(){
  await perform(async()=>{
    const key=`olps_publication_${selectedSiteIdState.value}_${selectedDraftIdState.value}`
    const requestKey=localStorage.getItem(key)??crypto.randomUUID();localStorage.setItem(key,requestKey)
    await api('POST',`${sitePath.value}/publish`,{draftId:selectedDraftIdState.value,requestKey})
    localStorage.removeItem(key);message.value='网站发布流程已完成，请查看各个发布位置的结果。'
  })
}
async function pull(){await perform(async()=>{const result=await api<{question:string|null}>('POST',`${draftPath.value}/pull`);question.value=result.question;message.value=result.question?'请确认下面的内容。':'已取得协作成员发布的最新内容。'})}
async function continuePublication(){await perform(async()=>{const result=await api<{question:string|null}>('POST',`${draftPath.value}/continue`,{answer:answer.value});question.value=result.question;if(!result.question)answer.value='';message.value=result.question?'请继续确认下面的内容。':'已根据回答继续处理。'})}
async function retry(record:Publication,target:Result){await perform(async()=>{await api('POST',`${sitePath.value}/publish-records/${record.recordId}/targets/${target.targetId}/retry`);message.value='已重新处理这个发布位置。'})}
async function retryNotification(record:Publication,notification:Notification){await perform(async()=>{await api('POST',`${sitePath.value}/publish-records/${record.recordId}/notifications/${notification.provider}/retry`);message.value='已重新处理搜索引擎通知。'})}
async function download(record:Publication){await perform(async()=>{
  const response=await fetch(`${sitePath.value}/publish-records/${record.recordId}/download.zip`,{headers:{Authorization:`Bearer ${getAccessToken()}`}})
  if(!response.ok){const body=await response.json() as {error:string};throw new Error(body.error)}
  const url=URL.createObjectURL(await response.blob());const anchor=document.createElement('a');anchor.href=url;anchor.download='网站文件.zip';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
})}
</script>

<template>
  <section class="panel">
    <h1>发布网站</h1>
    <p>将当前编辑版本发布到网站托管和已经启用的发布位置。</p>
    <p v-if="!selectedSiteIdState">请先选择网站。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <div class="row">
      <button :disabled="busy || !selectedDraftIdState" @click="publish">{{ busy ? '正在处理…' : '发布网站' }}</button>
      <button class="secondary" :disabled="busy || !selectedDraftIdState" @click="pull">取得协作更新</button>
      <button class="secondary" :disabled="busy || !selectedSiteIdState" @click="load">刷新发布记录</button>
    </div>
    <section v-if="question" aria-label="协作内容确认">
      <h2>需要确认的内容</h2><p>{{ question }}</p>
      <label>你的处理要求<textarea v-model="answer" rows="4" /></label>
      <button :disabled="busy || !answer.trim()" @click="continuePublication">确认并继续</button>
    </section>
  </section>
  <section v-if="selectedSiteIdState" class="panel">
    <h2>发布位置</h2>
    <p>网站托管会保留每次发布的网站文件。其他位置会分别显示处理结果。</p>
    <ul><li>网站托管：始终启用</li><li v-for="target in targets" :key="target.targetId">{{ target.name }}：{{ target.enabled ? '已启用' : '未启用' }}</li></ul>
  </section>
  <section class="panel">
    <h2>发布记录</h2><p v-if="!records.length">还没有发布记录。</p>
    <article v-for="record in records" :key="record.recordId" class="publication-record">
      <h3>{{ new Date(record.createdAt).toLocaleString() }}</h3>
      <p>{{ label(record.status) }} · {{ record.kind === 'assets_only' ? '仅更新图片和附件' : '更新整个网站' }}</p>
      <p v-if="record.error" class="error">{{ record.error }}</p>
      <div class="row"><a v-if="record.publicUrl" class="btn" :href="record.publicUrl" target="_blank" rel="noopener">查看网站</a><button v-if="record.publicUrl" class="secondary" :disabled="busy" @click="download(record)">下载此次网站文件</button></div>
      <ul>
        <li>网站托管：{{ record.publicUrl ? '已发布' : label(record.status) }}</li>
        <li v-for="target in record.targets" :key="target.targetId">
          {{ targets.find(item => item.targetId === target.targetId)?.name ?? '发布位置' }}：{{ label(target.status) }}，上传 {{ target.uploaded }} 个文件，移除 {{ target.removed }} 个文件
          <p v-if="target.error" class="error">{{ target.error }}</p>
          <button v-if="target.status === 'failed'" class="secondary" :disabled="busy" @click="retry(record,target)">重新发布到此位置</button>
        </li>
        <li v-for="notification in record.notifications" :key="notification.provider">
          {{ notification.provider === 'indexnow' ? '搜索引擎更新通知' : 'Google 网站更新通知' }}：{{ label(notification.status) }}
          <p v-if="notification.error">{{ notification.error }}</p>
          <button v-if="notification.status !== 'completed'" class="secondary" :disabled="busy" @click="retryNotification(record,notification)">重新发送通知</button>
        </li>
      </ul>
    </article>
    <button v-if="hasMoreHistory" class="secondary" :disabled="busy||loadingHistory" @click="loadMoreHistory">{{ loadingHistory ? '正在读取…' : '加载更多发布记录' }}</button>
  </section>
</template>

<style scoped>
.publication-record{border-top:1px solid var(--line);padding:1rem 0}.publication-record li{margin:.75rem 0}
</style>

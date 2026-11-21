<script setup lang="ts">
import { ref,watch } from 'vue'
import { api } from '../api'
import { selectedSiteIdState } from '../workspaceSession'
import { contentLocale } from '../cms-state'
type Inquiry={inquiryId:string;source:'public'|'preview';status:'new'|'qualified'|'invalid'|'handled';locale:string;createdAt:string;deliveries:Array<{taskId:string;kind:string;status:string;attempts:number;error:string|null}>;payload:{contentTitle:string;fields:{name:string;email:string;message:string};attribution:Record<string,unknown>}}
const inquiries=ref<Inquiry[]>([]),source=ref<'public'|'preview'>('public'),error=ref(''),busy=ref(false),loading=ref(false),status=ref(''),query=ref(''),nextCursor=ref<string|null>(null),hasMore=ref(false)
let generation=0
const statusLabels={new:'待处理',qualified:'有效询盘',invalid:'无效询盘',handled:'已处理'}
const deliveryLabels:Record<string,string>={email:'邮件通知',submit_conversion:'提交转化',qualified_conversion:'有效询盘转化'}
const deliveryStatus:Record<string,string>={pending:'等待发送',completed:'发送完成',failed:'发送失败',blocked:'等待配置或授权'}
const deliveryErrors:Record<string,string>={ADVERTISING_CONSENT_REQUIRED:'访客未同意广告追踪，因此没有发送营销转化。',NOT_CONNECTED:'请在营销连接中完成平台授权。',PREVIEW_EXTERNAL_SEND_DISABLED:'预览询盘不发送外部通知。'}
const attributionLabels:Record<string,string>={utm_source:'来源网站',utm_medium:'来源方式',utm_campaign:'推广活动',referrer:'来源页面',landingUrl:'访问页面'}
const nextStatuses:Record<Inquiry['status'],Inquiry['status'][] >={new:['qualified','invalid'],qualified:['handled'],invalid:['handled'],handled:[]}
async function load(append=false){
  if(append&&loading.value)return
  const current=++generation
  if(!selectedSiteIdState.value){inquiries.value=[];nextCursor.value=null;hasMore.value=false;return}
  error.value='';loading.value=true
  const parameters=new URLSearchParams({source:source.value,locale:contentLocale.value,limit:'50'})
  if(status.value)parameters.set('status',status.value)
  if(query.value.trim())parameters.set('q',query.value.trim())
  if(append&&nextCursor.value)parameters.set('cursor',nextCursor.value)
  try{const result=await api<{inquiries:Inquiry[];pageInfo:{nextCursor:string|null;hasNextPage:boolean}}>('GET',`/api/sites/${encodeURIComponent(selectedSiteIdState.value)}/inquiries?${parameters}`);if(current===generation){inquiries.value=append?[...inquiries.value,...result.inquiries]:result.inquiries;nextCursor.value=result.pageInfo.nextCursor;hasMore.value=result.pageInfo.hasNextPage}}
  catch(cause){if(current===generation)error.value=cause instanceof Error?cause.message:String(cause)}finally{if(current===generation)loading.value=false}
}
watch([selectedSiteIdState,source,contentLocale,status],()=>load(),{immediate:true})
async function changeStatus(inquiry:Inquiry,status:Inquiry['status']){if(busy.value)return;busy.value=true;error.value='';try{await api('PATCH',`/api/sites/${encodeURIComponent(selectedSiteIdState.value)}/inquiries/${inquiry.inquiryId}`,{status});await load()}catch(cause){error.value=cause instanceof Error?cause.message:String(cause)}finally{busy.value=false}}
async function retryDelivery(inquiry:Inquiry,taskId:string){if(busy.value)return;busy.value=true;error.value='';try{await api('POST',`/api/sites/${selectedSiteIdState.value}/inquiries/${inquiry.inquiryId}/deliveries/${taskId}/retry`);await load()}catch(cause){error.value=cause instanceof Error?cause.message:String(cause)}finally{busy.value=false}}
</script>
<template>
  <section class="panel"><h1>客户询盘</h1><p v-if="!selectedSiteIdState">请先选择网站。</p><p v-if="error" role="alert" class="error">{{ error }}</p>
    <form class="row" @submit.prevent="load()"><label>询盘来源<select v-model="source"><option value="public">公开网站</option><option value="preview">编辑预览</option></select></label><label>处理状态<select v-model="status"><option value="">全部状态</option><option v-for="(label,value) in statusLabels" :key="value" :value="value">{{ label }}</option></select></label><label>搜索询盘<input v-model="query" type="search" placeholder="姓名、邮箱或询盘内容" /></label><button class="secondary" :disabled="busy||loading">搜索询盘</button><button type="button" class="secondary" :disabled="busy||loading" @click="load()">刷新询盘</button></form>
    <p v-if="source === 'preview'">预览询盘用于检查表单，不会发送邮件和营销通知。</p>
    <p v-if="!inquiries.filter(item => item.locale === contentLocale).length">当前语言还没有询盘。</p>
    <article v-for="inquiry in inquiries.filter(item => item.locale === contentLocale)" :key="inquiry.inquiryId" class="inquiry">
      <h2>{{ inquiry.payload.fields.name }}</h2><p>{{ statusLabels[inquiry.status] }} · {{ new Date(inquiry.createdAt).toLocaleString() }}</p>
      <p>来源：{{ inquiry.payload.contentTitle }}</p><p><a :href="`mailto:${inquiry.payload.fields.email}`">{{ inquiry.payload.fields.email }}</a></p><p class="message">{{ inquiry.payload.fields.message }}</p>
      <details v-if="Object.keys(inquiry.payload.attribution).some(key => attributionLabels[key])"><summary>访客来源信息</summary><dl><template v-for="(value,key) in inquiry.payload.attribution" :key="key"><template v-if="attributionLabels[key]"><dt>{{ attributionLabels[key] }}</dt><dd>{{ value }}</dd></template></template></dl></details>
      <div class="row"><button v-for="status in nextStatuses[inquiry.status]" :key="status" class="secondary" :disabled="busy" @click="changeStatus(inquiry,status)">标记为{{ statusLabels[status] }}</button></div>
      <details v-if="inquiry.deliveries?.length"><summary>通知发送情况</summary><div v-for="delivery in inquiry.deliveries" :key="delivery.taskId"><p>{{ deliveryLabels[delivery.kind] }}：{{ deliveryStatus[delivery.status] }}，已尝试 {{ delivery.attempts }} 次</p><p v-if="delivery.error">{{ deliveryErrors[delivery.error] || delivery.error }}</p><button v-if="['failed','blocked'].includes(delivery.status)" class="secondary" :disabled="busy" @click="retryDelivery(inquiry,delivery.taskId)">重新发送{{ deliveryLabels[delivery.kind] }}</button></div></details>
    </article>
    <button v-if="hasMore" class="secondary" :disabled="busy||loading" @click="load(true)">{{ loading ? '正在读取…' : '加载更多询盘' }}</button>
  </section>
</template>
<style scoped>.inquiry{border-top:1px solid var(--line);padding:1rem 0}.message{white-space:pre-wrap}dt{font-weight:600}</style>

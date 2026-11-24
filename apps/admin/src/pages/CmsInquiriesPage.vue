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
function statusTagType(value: Inquiry['status']): 'success' | 'warning' | 'info' | 'danger' {
  if (value === 'qualified' || value === 'handled') return 'success'
  if (value === 'invalid') return 'danger'
  return 'warning'
}
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
  <el-card class="panel-card" shadow="never">
    <h1>客户询盘</h1>
    <el-alert v-if="!selectedSiteIdState" title="请先选择网站。" type="warning" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
    <el-form class="row filters" @submit.prevent="load()">
      <el-form-item label="询盘来源">
        <el-select v-model="source" style="width: 140px">
          <el-option label="公开网站" value="public" />
          <el-option label="编辑预览" value="preview" />
        </el-select>
      </el-form-item>
      <el-form-item label="处理状态">
        <el-select v-model="status" style="width: 140px">
          <el-option label="全部状态" value="" />
          <el-option v-for="(label,value) in statusLabels" :key="value" :label="label" :value="value" />
        </el-select>
      </el-form-item>
      <el-form-item label="搜索询盘">
        <el-input v-model="query" clearable placeholder="姓名、邮箱或询盘内容" style="width: 240px" />
      </el-form-item>
      <el-form-item>
        <el-button :loading="busy||loading" native-type="submit">搜索询盘</el-button>
        <el-button :disabled="busy||loading" @click="load()">刷新询盘</el-button>
      </el-form-item>
    </el-form>
    <el-alert v-if="source === 'preview'" title="预览询盘用于检查表单，不会发送邮件和营销通知。" type="info" show-icon :closable="false" class="page-alert" />
    <el-empty v-if="!inquiries.filter(item => item.locale === contentLocale).length" description="当前语言还没有询盘。" :image-size="72" />
    <article v-for="inquiry in inquiries.filter(item => item.locale === contentLocale)" :key="inquiry.inquiryId" class="inquiry">
      <div class="inquiry-heading">
        <h2>{{ inquiry.payload.fields.name }}</h2>
        <el-tag size="small" :type="statusTagType(inquiry.status)">{{ statusLabels[inquiry.status] }}</el-tag>
        <span class="muted">{{ new Date(inquiry.createdAt).toLocaleString() }}</span>
      </div>
      <p>来源：{{ inquiry.payload.contentTitle }}</p>
      <p><el-link type="primary" :href="`mailto:${inquiry.payload.fields.email}`">{{ inquiry.payload.fields.email }}</el-link></p>
      <p class="message">{{ inquiry.payload.fields.message }}</p>
      <details v-if="Object.keys(inquiry.payload.attribution).some(key => attributionLabels[key])">
        <summary>访客来源信息</summary>
        <dl>
          <template v-for="(value,key) in inquiry.payload.attribution" :key="key">
            <template v-if="attributionLabels[key]">
              <dt>{{ attributionLabels[key] }}</dt>
              <dd>{{ value }}</dd>
            </template>
          </template>
        </dl>
      </details>
      <div class="row">
        <el-button
          v-for="nextStatus in nextStatuses[inquiry.status]"
          :key="nextStatus"
          :disabled="busy"
          @click="changeStatus(inquiry,nextStatus)"
        >标记为{{ statusLabels[nextStatus] }}</el-button>
      </div>
      <details v-if="inquiry.deliveries?.length">
        <summary>通知发送情况</summary>
        <div v-for="delivery in inquiry.deliveries" :key="delivery.taskId" class="delivery">
          <p>{{ deliveryLabels[delivery.kind] }}：{{ deliveryStatus[delivery.status] }}，已尝试 {{ delivery.attempts }} 次</p>
          <p v-if="delivery.error">{{ deliveryErrors[delivery.error] || delivery.error }}</p>
          <el-button
            v-if="['failed','blocked'].includes(delivery.status)"
            size="small"
            :disabled="busy"
            @click="retryDelivery(inquiry,delivery.taskId)"
          >重新发送{{ deliveryLabels[delivery.kind] }}</el-button>
        </div>
      </details>
    </article>
    <el-button v-if="hasMore" :loading="loading" :disabled="busy" @click="load(true)">{{ loading ? '正在读取…' : '加载更多询盘' }}</el-button>
  </el-card>
</template>
<style scoped>
.panel-card h1 { margin-top: 0; }
.page-alert { margin-bottom: 12px; }
.filters { flex-wrap: wrap; align-items: flex-end; }
.filters :deep(.el-form-item) { margin-bottom: 12px; }
.inquiry { border-top: 1px solid var(--el-border-color-lighter); padding: 1rem 0; }
.inquiry-heading { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.inquiry-heading h2 { margin: 0; }
.message { white-space: pre-wrap; }
.muted { color: var(--el-text-color-secondary); }
.delivery { margin: 8px 0; }
dt { font-weight: 600; }
</style>

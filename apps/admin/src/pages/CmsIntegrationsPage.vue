<script setup lang="ts">
import { computed, onMounted,ref, watch } from 'vue'
import {useRoute,useRouter} from 'vue-router'
import { api } from '../cms-config-api'
import { selectedDraftIdState } from '../workspaceSession'
import {selectSite,selectDraft,siteDrafts,type CmsSite} from '../cms-state'
type Integration = { connector: string; status: string; accountId: string | null; publicConfig: Record<string, unknown>; missingEnvironment: string[]; lastSyncedAt: string | null; error: string | null }
type Account = { id: string; name: string }
const names: Record<string,string> = { ga4:'Google Analytics', googleAds:'Google Ads', searchConsole:'Google Search Console', meta:'Meta Pixel', gtm:'Google Tag Manager', tiktok:'TikTok Pixel', linkedin:'LinkedIn Insight Tag', clarity:'Microsoft Clarity', uet:'Microsoft UET' }
const fields: Record<string,Array<{key:string;label:string}>> = { gtm:[{key:'containerId',label:'容器编号'}],tiktok:[{key:'pixelId',label:'Pixel 编号'}],linkedin:[{key:'partnerId',label:'合作伙伴编号'},{key:'conversionId',label:'转化编号（选填）'}],clarity:[{key:'projectId',label:'项目编号'}],uet:[{key:'tagId',label:'标记编号'}] }
const integrations=ref<Integration[]>([]),revision=ref(''),error=ref(''),message=ref(''),busy=ref(false),values=ref<Record<string,Record<string,string>>>({}),accounts=ref<Record<string,Account[]>>({}),selected=ref<Record<string,string>>({})
const base=computed(()=>`/api/drafts/${encodeURIComponent(selectedDraftIdState.value)}/integrations`)
const route=useRoute(),router=useRouter()
let generation=0
async function action(work:()=>Promise<void>){busy.value=true;error.value='';message.value='';try{await work()}catch(cause){error.value=cause instanceof Error?cause.message:String(cause)}finally{busy.value=false}}
async function load(){const current=++generation;if(!selectedDraftIdState.value){integrations.value=[];return}const result=await api<{integrations:Integration[];revision:string}>('GET',base.value);if(current!==generation)return;integrations.value=result.integrations;revision.value=result.revision;values.value=Object.fromEntries(result.integrations.map(item=>[item.connector,Object.fromEntries((fields[item.connector]??[]).map(field=>[field.key,String(item.publicConfig[field.key]??'')]))]))}
async function save(item:Integration){await action(async()=>{const body=fields[item.connector]?Object.fromEntries(Object.entries(values.value[item.connector]??{}).filter(([,value])=>value.trim())):{accountId:selected.value[item.connector]};await api('PUT',`${base.value}/${item.connector}`,body,{headers:{'If-Match':revision.value}});await load();message.value='集成配置已保存'})}
async function connect(item:Integration){await action(async()=>{const provider=item.connector==='meta'?'meta':'google';const result=await api<{url:string}>('POST',`${base.value}/oauth/${provider}`);window.location.assign(result.url)})}
async function choose(item:Integration){await action(async()=>{const result=await api<{accounts:Account[]}>('GET',`${base.value}/${item.connector}/accounts`);accounts.value[item.connector]=result.accounts;selected.value[item.connector]=item.accountId??result.accounts[0]?.id??''})}
async function disconnect(item:Integration){await action(async()=>{await api('DELETE',`${base.value}/${item.connector}`,undefined,{headers:{'If-Match':revision.value}});await load();message.value='已经断开连接'})}
watch(selectedDraftIdState,()=>action(load),{immediate:true})
onMounted(()=>{if(typeof route.query.siteId!=='string'||typeof route.query.draftId!=='string')return;const siteId=route.query.siteId,draftId=route.query.draftId,cancelled=route.query.cancelled==='1';void action(async()=>{const sites=(await api<{sites:CmsSite[]}>('GET','/api/sites')).sites;const site=sites.find(site=>site.siteId===siteId);if(!site)throw new Error('授权对应的网站不可访问');const draft=(await siteDrafts(siteId)).find(draft=>draft.draftId===draftId);if(!draft)throw new Error('授权对应的编辑版本不可访问');selectSite(site);selectDraft(draft);await load();message.value=cancelled?'授权已取消，可以重新连接':'授权已完成，请选择要连接的账户';await router.replace('/integrations')})})
</script>
<template>
  <section class="panel"><h1>集成</h1><p>连接统计、广告与搜索服务。广告转化仅在访客同意后发送。</p><p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="message" role="status">{{ message }}</p><p v-if="!selectedDraftIdState">请选择网站的编辑版本。</p>
    <div class="integration-grid"><article v-for="item in integrations" :key="item.connector" class="integration-card"><h2>{{ names[item.connector] }}</h2><p>{{ item.status==='connected'?'已连接':item.status==='needs_reconnect'?'需要重新授权':'尚未连接' }}</p><p v-if="item.error" class="error">{{ item.error }}</p><p v-if="item.lastSyncedAt">最近同步：{{ new Date(item.lastSyncedAt).toLocaleString() }}</p>
      <form v-if="fields[item.connector]" @submit.prevent="save(item)"><label v-for="field in fields[item.connector]" :key="field.key">{{ field.label }}<input v-model="values[item.connector]![field.key]" :required="field.key!=='conversionId'" /></label><button :disabled="busy">保存配置</button></form>
      <template v-else><p v-if="item.missingEnvironment.length">服务尚未完成授权设置，请联系管理员。</p><button :disabled="busy||!!item.missingEnvironment.length" @click="connect(item)">{{ item.status==='connected'?'重新授权':'授权连接' }}</button><button class="secondary" :disabled="busy||!!item.missingEnvironment.length" @click="choose(item)">选择账户</button><form v-if="accounts[item.connector]" @submit.prevent="save(item)"><label>账户<select v-model="selected[item.connector]"><option v-for="account in accounts[item.connector]" :key="account.id" :value="account.id">{{ account.name || account.id }}</option></select></label><p v-if="!accounts[item.connector]?.length">当前授权没有可选择的账户。</p><button :disabled="busy||!selected[item.connector]">使用此账户</button></form></template>
      <button v-if="item.status==='connected'" class="secondary" :disabled="busy" @click="disconnect(item)">断开连接</button>
    </article></div>
  </section>
</template>
<style scoped>.integration-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}.integration-card{border:1px solid #dbe2ea;border-radius:12px;padding:20px}.integration-card button{margin:8px 8px 0 0}label{display:grid;gap:6px;margin:12px 0}input,select{width:100%;padding:9px}</style>

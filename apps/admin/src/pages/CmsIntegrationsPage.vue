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
function statusLabel(status: string): string {
  if (status === 'connected') return '已连接'
  if (status === 'needs_reconnect') return '需要重新授权'
  return '尚未连接'
}
function statusTagType(status: string): 'success' | 'warning' | 'info' {
  if (status === 'connected') return 'success'
  if (status === 'needs_reconnect') return 'warning'
  return 'info'
}
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
  <section>
    <h1>营销连接</h1>
    <p>连接统计、广告与搜索服务。广告转化仅在访客同意后发送。</p>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="!selectedDraftIdState" title="请选择网站的编辑版本。" type="warning" show-icon :closable="false" class="page-alert" />
    <div class="integration-grid">
      <el-card v-for="item in integrations" :key="item.connector" shadow="never" class="integration-card">
        <template #header>
          <div class="card-header">
            <span>{{ names[item.connector] }}</span>
            <el-tag size="small" :type="statusTagType(item.status)">{{ statusLabel(item.status) }}</el-tag>
          </div>
        </template>
        <el-alert v-if="item.error" :title="item.error" type="error" show-icon :closable="false" class="page-alert" />
        <p v-if="item.lastSyncedAt" class="muted">最近同步：{{ new Date(item.lastSyncedAt).toLocaleString() }}</p>
        <el-form v-if="fields[item.connector]" label-position="top" @submit.prevent="save(item)">
          <el-form-item
            v-for="field in fields[item.connector]"
            :key="field.key"
            :label="field.label"
            :required="field.key !== 'conversionId'"
          >
            <el-input v-model="values[item.connector]![field.key]" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="busy" native-type="submit">保存配置</el-button>
          </el-form-item>
        </el-form>
        <template v-else>
          <el-alert
            v-if="item.missingEnvironment.length"
            title="服务尚未完成授权设置，请联系管理员。"
            type="warning"
            show-icon
            :closable="false"
            class="page-alert"
          />
          <div class="row">
            <el-button type="primary" :disabled="busy||!!item.missingEnvironment.length" @click="connect(item)">{{ item.status==='connected'?'重新授权':'授权连接' }}</el-button>
            <el-button :disabled="busy||!!item.missingEnvironment.length" @click="choose(item)">选择账户</el-button>
          </div>
          <el-form v-if="accounts[item.connector]" label-position="top" class="account-form" @submit.prevent="save(item)">
            <el-form-item label="账户">
              <el-select v-model="selected[item.connector]" style="width: 100%">
                <el-option
                  v-for="account in accounts[item.connector]"
                  :key="account.id"
                  :label="account.name || account.id"
                  :value="account.id"
                />
              </el-select>
            </el-form-item>
            <el-empty v-if="!accounts[item.connector]?.length" description="当前授权没有可选择的账户。" :image-size="56" />
            <el-form-item>
              <el-button type="primary" :disabled="busy||!selected[item.connector]" native-type="submit">使用此账户</el-button>
            </el-form-item>
          </el-form>
        </template>
        <el-button v-if="item.status==='connected'" class="disconnect" :disabled="busy" @click="disconnect(item)">断开连接</el-button>
      </el-card>
    </div>
  </section>
</template>
<style scoped>
.page-alert { margin-bottom: 12px; }
.integration-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
.card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.muted { color: var(--el-text-color-secondary); }
.account-form { margin-top: 16px; }
.disconnect { margin-top: 12px; }
</style>

<script setup lang="ts">
import { computed,ref,watch } from 'vue'
import type { UploadFile } from 'element-plus'
import { api,ApiError } from '../cms-config-api'
import { selectedDraftIdState } from '../workspaceSession'
import { contentLocale } from '../cms-state'
import CmsSettingsFields,{type SettingField} from '../components/CmsSettingsFields.vue'
type Plugin={manifest:{id:string;name:string;version:string;description:string;settings:SettingField[];permissions:Record<string,unknown>};config:{enabled:boolean}|null}
type Settings={settings:Record<string,unknown>;secrets:Record<string,boolean>;revision:string}
const plugins=ref<Plugin[]>([]),revision=ref(''),busy=ref(false),error=ref(''),message=ref(''),active=ref<Plugin|null>(null),settings=ref<Record<string,unknown>>({}),configured=ref<Record<string,boolean>>({}),settingRevision=ref(''),permission=ref<Plugin|null>(null),logs=ref<Array<Record<string,unknown>>>([]),media=ref<Array<{mediaId:string;originalName:string}>>([])
const base=computed(()=>`/api/drafts/${encodeURIComponent(selectedDraftIdState.value)}`)
let generation=0
async function action(work:()=>Promise<void>){busy.value=true;error.value='';message.value='';try{await work()}catch(cause){error.value=cause instanceof Error?cause.message:String(cause);if(cause instanceof ApiError&&cause.code==='PERMISSION_CONFIRMATION_REQUIRED')error.value='启用插件需要确认所需权限'}finally{busy.value=false}}
async function load(){const current=++generation;if(!selectedDraftIdState.value){plugins.value=[];return}const path=base.value;const [result,assets]=await Promise.all([api<{plugins:Plugin[];revision:string}>('GET',`${path}/plugins`),api<{media:Array<{media:{mediaId:string;originalName:string}}>} >('GET',`${path}/media`)]);if(current!==generation)return;plugins.value=result.plugins;revision.value=result.revision;media.value=assets.media.map(item=>item.media)}
async function uploadPlugin(uploadFile:UploadFile){const file=uploadFile.raw;if(!file)return;await action(async()=>{const body=new FormData();body.append('file',file);await api('POST',`${base.value}/plugins`,body);await load();message.value='插件已经安装'})}
async function toggle(plugin:Plugin,confirmed=false){if(!plugin.config?.enabled&&!confirmed&&Object.keys(plugin.manifest.permissions??{}).length){permission.value=plugin;return}await action(async()=>{await api('PUT',`${base.value}/plugins/${plugin.manifest.id}`,{enabled:!plugin.config?.enabled,confirmPermissions:confirmed},{headers:{'If-Match':revision.value}});permission.value=null;await load()})}
async function edit(plugin:Plugin){await action(async()=>{const result=await api<Settings>('GET',`${base.value}/plugins/${plugin.manifest.id}/settings`);active.value=plugin;settings.value=result.settings;configured.value=result.secrets;settingRevision.value=result.revision;logs.value=[]})}
async function save(){if(!active.value)return;await action(async()=>{const result=await api<Settings>('PUT',`${base.value}/plugins/${active.value!.manifest.id}/settings`,{settings:settings.value},{headers:{'If-Match':settingRevision.value}});settings.value=result.settings;configured.value=result.secrets;settingRevision.value=result.revision;await load();message.value='插件设置已保存'})}
async function remove(plugin:Plugin){await action(async()=>{await api('DELETE',`${base.value}/plugins/${plugin.manifest.id}`,undefined,{headers:{'If-Match':revision.value}});if(active.value?.manifest.id===plugin.manifest.id)active.value=null;await load()})}
async function readLogs(){if(!active.value)return;await action(async()=>{const result=await api<{logs:Array<Record<string,unknown>>}>('GET',`${base.value}/plugins/${active.value!.manifest.id}/logs`);logs.value=result.logs})}
function closePermission(open:boolean){if(!open)permission.value=null}
watch(selectedDraftIdState,()=>{active.value=null;void action(load)},{immediate:true})
</script>
<template>
  <section class="panel">
    <h1>插件</h1>
    <p>安装扩展，并按网站需要启用相关功能。</p>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="page-alert" />
    <el-upload
      :auto-upload="false"
      :show-file-list="false"
      accept=".zip"
      :disabled="busy||!selectedDraftIdState"
      :on-change="uploadPlugin"
    >
      <el-button :disabled="busy||!selectedDraftIdState">安装插件压缩包</el-button>
    </el-upload>

    <el-dialog
      :model-value="permission !== null"
      :title="permission ? `确认启用 ${permission.manifest.name}` : '确认插件权限'"
      width="520px"
      @update:model-value="closePermission"
    >
      <template v-if="permission">
        <p>此插件需要以下权限：</p>
        <ul>
          <li v-for="(value,key) in permission.manifest.permissions" :key="key">
            {{ key==='network'?'访问外部服务':key==='storage'?'保存插件数据':key==='inquiries'?'访问询盘信息':'使用插件服务器功能' }}：{{ Array.isArray(value)?value.join('、'):String(value) }}
          </li>
        </ul>
      </template>
      <template #footer>
        <el-button type="primary" :loading="busy" @click="permission && toggle(permission,true)">确认并启用</el-button>
        <el-button @click="permission=null">取消</el-button>
      </template>
    </el-dialog>

    <div class="plugin-grid">
      <el-card v-for="plugin in plugins" :key="plugin.manifest.id" shadow="never">
        <h2>{{ plugin.manifest.name }}</h2>
        <p>版本 {{ plugin.manifest.version }} · {{ plugin.config?.enabled?'已启用':'已停用' }}</p>
        <div class="row">
          <el-button type="primary" :loading="busy" @click="toggle(plugin)">{{ plugin.config?.enabled?'停用':'启用' }}</el-button>
          <el-button :disabled="busy" @click="edit(plugin)">设置</el-button>
          <el-button v-if="!plugin.config?.enabled" :disabled="busy" @click="remove(plugin)">删除插件</el-button>
        </div>
      </el-card>
    </div>

    <el-form v-if="active" label-position="top" class="plugin-form" @submit.prevent="save">
      <h2>{{ active.manifest.name }}设置</h2>
      <CmsSettingsFields
        v-model="settings"
        :fields="active.manifest.settings"
        :configured-secrets="configured"
        :media="media"
        :locale="contentLocale"
      />
      <div class="row">
        <el-button type="primary" :loading="busy" native-type="submit">保存设置</el-button>
        <el-button :disabled="busy" @click="readLogs">查看运行记录</el-button>
      </div>
      <ul v-if="logs.length">
        <li v-for="(log,index) in logs" :key="index">
          {{ log.created_at?new Date(String(log.created_at)).toLocaleString():'' }} {{ log.message }}
        </li>
      </ul>
    </el-form>
  </section>
</template>
<style scoped>
.plugin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin:20px 0}
.page-alert{margin:12px 0}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.plugin-form{max-width:700px;margin-top:20px}
</style>

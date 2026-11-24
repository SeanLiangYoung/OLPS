<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import type {AppearanceConfig} from '@olps/domain'
import type {UploadFile} from 'element-plus'
import {api,ApiError} from '../cms-config-api'
import {selectedDraftIdState} from '../workspaceSession'
import {contentLocale} from '../cms-state'
import CmsSettingsFields,{type SettingField} from '../components/CmsSettingsFields.vue'
import CmsMenuEditor from '../components/CmsMenuEditor.vue'
import {listCmsContent} from '../cms-config-api'
type Theme={manifest:{id:string;name:string;version:string;settings:SettingField[];menus:Array<{id:string;name:string}>};active:boolean}
type Content={meta:Record<string,string>;locale:{title:string}}
const route=useRoute(),section=computed(()=>String(route.params.section??'themes')),themes=ref<Theme[]>([]),appearance=ref<AppearanceConfig|null>(null),revision=ref(''),strings=ref<Record<string,string>>({}),stringsRevision=ref(''),error=ref(''),message=ref(''),busy=ref(false),impact=ref<{theme:Theme;usages:Array<{path:string;field:string}>}|null>(null),media=ref<Array<{mediaId:string;originalName:string}>>([]),targets=ref<Array<{ref:'page'|'collection';id:string;title:string}>>([])
const base=computed(()=>`/api/drafts/${encodeURIComponent(selectedDraftIdState.value)}`),active=computed(()=>themes.value.find(theme=>theme.active)),titles:Record<string,string>={themes:'主题',customize:'外观定制',menus:'导航菜单',texts:'固定文字'}
const previewUrl=ref('')
let generation=0
async function refreshPreview(){const current=generation,draft=selectedDraftIdState.value;const result=await api<{previewUrl:string}>('POST',`${base.value}/preview`,{locale:contentLocale.value,returnPath:'/appearance/customize'});if(current===generation&&draft===selectedDraftIdState.value)previewUrl.value=result.previewUrl}
async function action(work:()=>Promise<void>){busy.value=true;error.value='';message.value='';try{await work()}catch(cause){error.value=cause instanceof Error?cause.message:String(cause)}finally{busy.value=false}}
async function load(){const current=++generation;previewUrl.value='';if(!selectedDraftIdState.value){appearance.value=null;return}const [list,config,localized,assets,pages,collections]=await Promise.all([api<{themes:Theme[]}>('GET',`${base.value}/themes`),api<{appearance:AppearanceConfig;revision:string}>('GET',`${base.value}/appearance`),api<{i18n:{strings:Record<string,string>};revision:string}>('GET',`${base.value}/i18n/${contentLocale.value}`),api<{media:Array<{media:{mediaId:string;path:string}}>} >('GET',`${base.value}/media`),listCmsContent<Content>(base.value,'pages',contentLocale.value),listCmsContent<Content>(base.value,'collections',contentLocale.value)]);if(current!==generation)return;themes.value=list.themes;appearance.value=config.appearance;revision.value=config.revision;strings.value=localized.i18n.strings;stringsRevision.value=localized.revision;media.value=assets.media.map(item=>({mediaId:item.media.mediaId,originalName:item.media.path.split('/').at(-1)??'媒体文件'}));targets.value=[...pages.map(item=>({ref:'page' as const,id:item.meta.pageId!,title:item.locale.title})),...collections.map(item=>({ref:'collection' as const,id:item.meta.collectionId!,title:item.locale.title}))];if(section.value==='customize')await refreshPreview()}
async function save(){await action(async()=>{if(section.value==='texts'){const result=await api<{revision:string}>('PUT',`${base.value}/i18n/${contentLocale.value}`,{schemaVersion:1,strings:strings.value},{headers:{'If-Match':stringsRevision.value}});stringsRevision.value=result.revision}else{const result=await api<{revision:string}>('PUT',`${base.value}/appearance`,appearance.value,{headers:{'If-Match':revision.value}});revision.value=result.revision}if(section.value==='customize')await refreshPreview();message.value='外观设置已保存'})}
async function activate(theme:Theme,confirmImpact=false){await action(async()=>{try{await api('POST',`${base.value}/themes/${theme.manifest.id}/activate`,{confirmImpact},{headers:{'If-Match':revision.value}});impact.value=null;await load()}catch(cause){if(cause instanceof ApiError&&cause.code==='THEME_CHANGE_REQUIRES_CONFIRMATION'){impact.value={theme,usages:(cause.details as {usages:Array<{path:string;field:string}>}).usages};return}throw cause}})}
async function uploadTheme(uploadFile:UploadFile){const file=uploadFile.raw;if(!file)return;await action(async()=>{const body=new FormData();body.append('file',file);await api('POST',`${base.value}/themes`,body);await load();message.value='主题已经安装'})}
async function remove(theme:Theme){await action(async()=>{await api('DELETE',`${base.value}/themes/${theme.manifest.id}`,undefined,{headers:{'If-Match':revision.value}});await load()})}
function stringLabel(key:string){const part=key.split(':').at(-1)??key;const labels:Record<string,string>={home:'首页',cookie_settings:'Cookie 设置',previous:'上一项',next:'下一项',related:'相关内容',menu:'菜单',language:'语言',pagination_prev:'上一页',pagination_next:'下一页',breadcrumb_home:'导航首页',whatsapp_button:'WhatsApp 按钮文字',inquiry_heading:'询盘标题',inquiry_name:'询盘姓名',inquiry_email:'询盘邮箱',inquiry_message:'询盘留言',inquiry_privacy_prefix:'隐私同意文字',inquiry_privacy_link:'隐私政策链接文字',inquiry_submit:'询盘提交按钮',maps_heading:'地图标题',maps_open:'地图打开按钮',search:'搜索',search_placeholder:'搜索内容',read_more:'阅读更多',submit:'提交',contact:'联系我们',copyright:'版权文字',not_found:'页面不存在',back_home:'返回首页'};return labels[part]??strings.value[key]??'固定文字'}
function closeImpact(open:boolean){if(!open)impact.value=null}
watch([selectedDraftIdState,contentLocale,section],()=>action(load),{immediate:true})
</script>
<template>
  <section class="panel">
    <h1>{{ titles[section] }}</h1>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="page-alert" />
    <p v-if="!selectedDraftIdState">请选择网站的编辑版本。</p>

    <template v-if="section==='themes'">
      <el-upload
        :auto-upload="false"
        :show-file-list="false"
        accept=".zip"
        :disabled="busy"
        :on-change="uploadTheme"
      >
        <el-button :disabled="busy">安装主题压缩包</el-button>
      </el-upload>
      <div class="theme-grid">
        <el-card v-for="theme in themes" :key="theme.manifest.id" shadow="never">
          <h2>{{ theme.manifest.name==='Starter'?'基础主题':theme.manifest.name }}</h2>
          <p>版本 {{ theme.manifest.version }} · {{ theme.active?'当前主题':'尚未启用' }}</p>
          <div class="row">
            <el-button v-if="!theme.active" type="primary" :loading="busy" @click="activate(theme)">启用主题</el-button>
            <el-button v-if="!theme.active" :disabled="busy" @click="remove(theme)">删除主题</el-button>
          </div>
        </el-card>
      </div>
      <el-dialog :model-value="impact !== null" title="确认主题变化" width="520px" @update:model-value="closeImpact">
        <p v-if="impact">当前内容有 {{ impact.usages.length }} 处使用原主题功能，切换后这些部分需要更新。</p>
        <template #footer>
          <el-button type="primary" :loading="busy" @click="impact && activate(impact.theme,true)">确认切换</el-button>
          <el-button @click="impact=null">取消</el-button>
        </template>
      </el-dialog>
    </template>

    <el-form v-else-if="appearance" label-position="top" class="appearance-form" @submit.prevent="save">
      <CmsSettingsFields
        v-if="section==='customize'&&active"
        v-model="appearance.themeSettings"
        :fields="active.manifest.settings"
        :media="media"
        :locale="contentLocale"
      />
      <template v-if="section==='menus'">
        <el-card v-for="menu in active?.manifest.menus" :key="menu.id" class="menu-card" shadow="never">
          <h2>{{ menu.id==='primary'?'主菜单':menu.id==='footer'?'页脚菜单':menu.name }}</h2>
          <CmsMenuEditor
            :model-value="appearance.menus[menu.id]??[]"
            :locale="contentLocale"
            :targets="targets"
            @update:model-value="appearance!.menus[menu.id]=$event"
          />
        </el-card>
      </template>
      <template v-if="section==='texts'">
        <p>正在编辑当前语言的主题与插件固定文字。</p>
        <el-form-item v-for="(_,key) in strings" :key="key" :label="stringLabel(String(key))">
          <el-input v-model="strings[key]" />
        </el-form-item>
        <p v-if="!Object.keys(strings).length">当前主题和插件没有需要编辑的固定文字。</p>
      </template>
      <el-form-item>
        <el-button type="primary" :loading="busy" native-type="submit">保存设置</el-button>
      </el-form-item>
    </el-form>

    <aside v-if="section==='customize'" class="appearance-preview">
      <h2>网站预览</h2>
      <p>保存后更新预览。</p>
      <iframe v-if="previewUrl" :src="previewUrl" title="外观预览" sandbox="allow-scripts allow-forms" />
      <p v-else>正在准备网站预览…</p>
    </aside>
  </section>
</template>
<style scoped>
.theme-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin:20px 0}
.page-alert{margin-bottom:12px}
.row{display:flex;flex-wrap:wrap;gap:8px}
.appearance-form{max-width:850px}
.menu-card{margin:14px 0}
.appearance-preview iframe{width:100%;min-height:680px;border:1px solid var(--el-border-color)}
.panel:has(.appearance-preview){display:grid;grid-template-columns:minmax(260px,1fr) minmax(400px,2fr);column-gap:24px}
.panel:has(.appearance-preview)>h1,.panel:has(.appearance-preview)>p,.panel:has(.appearance-preview)>.page-alert{grid-column:1/-1}
.appearance-preview{grid-column:2;grid-row:2/span 20}
.panel:has(.appearance-preview)>.appearance-form{grid-column:1}
@media(max-width:1000px){.panel:has(.appearance-preview){display:block}.appearance-preview{margin-top:20px}}
</style>

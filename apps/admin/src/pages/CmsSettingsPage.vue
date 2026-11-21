<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {useRoute} from 'vue-router'
import type {ManagedSiteSettings,CollectionDefinition,FieldDefinition} from '@olps/domain'
import {loadSiteModel} from '@olps/render'
import {api,ApiError} from '../cms-config-api'
import {selectedDraftIdState,selectedSiteIdState} from '../workspaceSession'
import {contentLocale} from '../cms-state'
import OwnersPanel from '../components/OwnersPanel.vue'
import {listCmsContent} from '../cms-config-api'
import {createApiSourceReader} from '../editor/source-reader'
type Content={ref:'collection';meta:CollectionDefinition;locale:Record<string,unknown>}
type Target={targetId:string;name:string;type:string;enabled:boolean}
type AffectedObject = { ref: 'group' | 'item'; id: string }
type AffectedLink = AffectedObject & { title: string; locale: string; collectionId: string }
type CollectionImpact = { groupCount: number; itemCount: number; objects: AffectedObject[] }
const route=useRoute(),section=computed(()=>String(route.params.section??'general')),settings=ref<ManagedSiteSettings|null>(null),revision=ref(''),busy=ref(false),error=ref(''),message=ref(''),localeCode=ref(''),localeDir=ref<'ltr'|'rtl'>('ltr'),collections=ref<Content[]>([]),editing=ref<Content|null>(null),contentRevision=ref(''),targets=ref<Target[]>([]),targetName=ref(''),targetType=ref('sftp'),targetId=ref<string|undefined>(),targetEnabled=ref(true),targetConfig=ref<Record<string,string>>({}),media=ref<Array<{mediaId:string;path:string}>>([])
const titles:Record<string,string>={general:'常规设置',search:'搜索设置','content-types':'内容类型',targets:'发布目标',members:'成员管理'}
const base=computed(()=>`/api/drafts/${encodeURIComponent(selectedDraftIdState.value)}`),siteBase=computed(()=>`/api/sites/${encodeURIComponent(selectedSiteIdState.value)}`)
const transfer=computed(()=>['ftp','ftps','sftp'].includes(targetType.value))
const targetFields=computed(()=>transfer.value?[{key:'host',label:'服务器地址'},{key:'port',label:'端口（选填）'},{key:'username',label:'登录账号'},{key:'password',label:'登录密码',secret:true},{key:'privateKey',label:'SSH 私钥（选填）',secret:true},{key:'root',label:'网站目录'},...(targetType.value==='sftp'?[{key:'hostKeySha256',label:'服务器 SHA-256 指纹'}]:[])]:[{key:'bucket',label:'存储桶名称'},{key:'region',label:'区域'},{key:'accessKeyId',label:'访问密钥编号',secret:true},{key:'secretAccessKey',label:'访问密钥',secret:true},{key:'endpoint',label:'服务地址（选填）'},{key:'prefix',label:'网站目录（选填）'},{key:'sessionToken',label:'临时授权令牌（选填）',secret:true}])
const fieldTypes:Record<string,string>={text:'单行文字',richtext:'丰富文字',number:'数字',boolean:'开关',select:'选项',date:'日期',media:'单个媒体',mediaList:'多个媒体',link:'链接',table:'表格',reference:'关联内容'}
const affectedLinks = ref<AffectedLink[]>([])
let generation=0
async function action(work: () => Promise<void>) {
  busy.value = true
  error.value = ''
  message.value = ''
  affectedLinks.value = []
  try {
    await work()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
async function load(){const current=++generation;if(!selectedDraftIdState.value){settings.value=null;return}const [config,list,assets,locations]=await Promise.all([api<{settings:ManagedSiteSettings;revision:string}>('GET',`${base.value}/settings`),listCmsContent<Content>(base.value,'collections',contentLocale.value),api<{media:Array<{media:{mediaId:string;path:string}}>} >('GET',`${base.value}/media`),selectedSiteIdState.value?api<{targets:Target[]}>('GET',`${siteBase.value}/deploy-targets`):Promise.resolve({targets:[]})]);if(current!==generation)return;settings.value=config.settings;revision.value=config.revision;collections.value=list;media.value=assets.media.map(item=>item.media);targets.value=locations.targets}
async function save(){await action(async()=>{const result=await api<{revision:string}>('PUT',`${base.value}/settings`,{settings:settings.value},{headers:{'If-Match':revision.value}});revision.value=result.revision;message.value='网站设置已保存'})}
async function addLocale(){await action(async()=>{await api('POST',`${base.value}/locales`,{code:localeCode.value,dir:localeDir.value},{headers:{'If-Match':revision.value}});localeCode.value='';await load();message.value='语言已经添加，内容可以开始翻译'})}
async function editCollection(content:Content){await action(async()=>{const result=await api<{content:Content;revision:string}>('GET',`${base.value}/content/collection/${content.meta.collectionId}?locale=${contentLocale.value}`);editing.value=result.content;contentRevision.value=result.revision})}
async function saveCollection() {
  const content = editing.value
  if (!content) return
  const draftId = selectedDraftIdState.value
  const preferredLocale = contentLocale.value
  const isCurrent = () => editing.value === content && selectedDraftIdState.value === draftId && contentLocale.value === preferredLocale && section.value === 'content-types'
  await action(async () => {
    try {
      await api('PUT', `${base.value}/content/collection/${content.meta.collectionId}`, content, { headers: { 'If-Match': `"${contentRevision.value}"` } })
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.code !== 'RESOURCE_IN_USE') throw cause
      if (!isCurrent()) return
      const { groupCount, itemCount, objects } = cause.details as CollectionImpact
      error.value = `内容类型变化会影响 ${groupCount} 个分组和 ${itemCount} 个条目，请先处理这些内容。`
      if (!objects.length) return
      const model = await loadSiteModel(createApiSourceReader(draftId))
      if (!isCurrent()) return
      const localeOrder = [preferredLocale, model.settings.defaultLocale, ...model.settings.locales.map(locale => locale.code)]
      const requested = new Set(objects.map(object => `${object.ref}:${object.id}`))
      affectedLinks.value = model.collections.flatMap(collection => {
        const entries = [
          ...collection.groups.map(group => ({ ref: 'group' as const, id: group.meta.groupId, locales: group.locales })),
          ...collection.items.map(item => ({ ref: 'item' as const, id: item.meta.itemId, locales: item.locales })),
        ]
        return entries.flatMap(({ ref, id, locales }) => {
          if (!requested.has(`${ref}:${id}`)) return []
          const locale = localeOrder.find(code => locales[code])
          if (!locale) return []
          return [{ ref, id, title: locales[locale].title, locale, collectionId: collection.definition.collectionId }]
        })
      })
      return
    }
    if (!isCurrent()) return
    await load()
    message.value = '内容类型已保存'
  })
}
function addField(){editing.value?.meta.fields.push({key:`field${(editing.value?.meta.fields.length??0)+1}`,type:'text',label:'新字段',required:false,translatable:true})}
const crypto=globalThis.crypto
function mediaTitle(item:unknown,index:number){const title=(item as {title?:Record<string,string>}).title;return title?.[contentLocale.value]||Object.values(title??{}).find(Boolean)||`媒体文件 ${index+1}`}
function changeFieldType(field:FieldDefinition){delete field.options;delete field.columns;delete field.referenceCollectionId;if(field.type==='select')field.options=[{value:'option1',label:'选项一'}];if(field.type==='table')field.columns=[{key:'column1',label:'第一列',type:'text'}];if(field.type==='reference')field.referenceCollectionId=collections.value.find(item=>item.meta.collectionId!==editing.value?.meta.collectionId)?.meta.collectionId}
function editTarget(target?:Target){targetId.value=target?.targetId;targetName.value=target?.name??'';targetType.value=target?.type??'sftp';targetEnabled.value=target?.enabled??true;targetConfig.value={}}
async function saveTarget(){await action(async()=>{const config:Record<string,unknown>=Object.fromEntries(Object.entries(targetConfig.value).filter(([,value])=>value!==''));if(config.port)config.port=Number(config.port);if(!targetId.value){if(transfer.value)config.root??='/';else config.prefix??=''}await api('POST',`${siteBase.value}/deploy-targets`,{...(targetId.value?{targetId:targetId.value}:{}),name:targetName.value,type:targetType.value,enabled:targetEnabled.value,config});editTarget();await load();message.value='发布目标已保存'})}
async function testTarget(target:Target){await action(async()=>{const result=await api<{connected:boolean;error?:string}>('POST',`${siteBase.value}/deploy-targets/${target.targetId}/test`);if(!result.connected)throw new Error(result.error??'连接未完成，请检查目标设置');message.value='发布目标连接正常'})}
async function deleteTarget(target:Target){await action(async()=>{await api('DELETE',`${siteBase.value}/deploy-targets/${target.targetId}`);await load();message.value='发布目标已删除'})}
watch([selectedDraftIdState,selectedSiteIdState,contentLocale],()=>{editing.value=null;void action(load)},{immediate:true})
</script>
<template><section class="panel"><h1>{{ titles[section] }}</h1><p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
  <section v-if="section==='content-types'&&affectedLinks.length" aria-label="受影响内容">
    <h2>受影响内容</h2>
    <ul><li v-for="entry in affectedLinks" :key="`${entry.ref}:${entry.id}`">
      <RouterLink :to="{ path: `/content/${entry.ref}/${entry.id}`, query: { locale: entry.locale, collectionId: entry.collectionId } }">{{ entry.ref === 'group' ? '分组' : '条目' }} · {{ entry.title }}</RouterLink>
    </li></ul>
  </section>
  <template v-if="section==='members'"><OwnersPanel v-if="selectedSiteIdState" scope="site" :resource-id="selectedSiteIdState" /><OwnersPanel v-if="selectedDraftIdState" scope="draft" :resource-id="selectedDraftIdState" /></template>
  <template v-else-if="section==='targets'">
    <p>发布时可以同时更新已启用的目标。登录密码和访问密钥保存后不会显示。</p>
    <article v-for="target in targets" :key="target.targetId"><strong>{{ target.name }}</strong><p>{{ target.type.toUpperCase() }} · {{ target.enabled?'已启用':'已停用' }}</p><button class="secondary" :disabled="busy" @click="editTarget(target)">编辑目标</button><button class="secondary" :disabled="busy" @click="testTarget(target)">测试连接</button><button class="secondary" :disabled="busy" @click="deleteTarget(target)">删除目标</button></article>
    <form @submit.prevent="saveTarget"><h2>{{ targetId?'编辑发布目标':'添加发布目标' }}</h2><label>名称<input v-model="targetName" required /></label><label>发布方式<select v-model="targetType" :disabled="!!targetId"><option value="ftp">FTP</option><option value="ftps">FTPS</option><option value="sftp">SFTP</option><option value="s3">Amazon S3</option><option value="oss">阿里云 OSS</option><option value="cos">腾讯云 COS</option></select></label><label v-for="field in targetFields" :key="field.key">{{ field.label }}<input v-model="targetConfig[field.key]" :type="field.secret?'password':'text'" autocomplete="off" :placeholder="targetId?'保留当前设置':''" /></label><label><input v-model="targetEnabled" type="checkbox" />启用此目标</label><button :disabled="busy||!selectedSiteIdState">保存目标</button></form>
  </template>
  <template v-else-if="section==='content-types'"><p>管理内容分组与字段。影响已有内容的修改会显示具体数量。</p><button v-for="collection in collections" :key="collection.meta.collectionId" class="secondary" @click="editCollection(collection)">{{ collection.meta.name }}</button><form v-if="editing" @submit.prevent="saveCollection"><label>内容类型名称<input v-model="editing.meta.name" required /></label><label>网址名称<input v-model="editing.meta.prefix" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></label><label>当前语言名称<input v-model="editing.meta.labels[contentLocale]" /></label><label>搜索引擎内容类型<select v-model="editing.meta.structuredData"><option :value="null">普通内容</option><option value="Product">产品</option><option value="NewsArticle">新闻</option><option value="Service">服务</option></select></label><label><input v-model="editing.meta.feed" type="checkbox" />生成订阅内容</label><h2>分组层级</h2><div v-for="(level,index) in editing.meta.levels" :key="level.levelId"><label>层级名称<input v-model="level.name" required /></label><button type="button" class="secondary" @click="editing.meta.levels.splice(index,1)">删除层级</button></div><button type="button" class="secondary" @click="editing.meta.levels.push({levelId:crypto.randomUUID(),name:'新层级'})">添加层级</button><h2>内容字段</h2><article v-for="(field,index) in editing.meta.fields" :key="index"><label>字段名称<input v-model="field.label" required /></label><label>字段标识<input v-model="field.key" pattern="[a-z][a-zA-Z0-9_]*" required /></label><label>字段类型<select v-model="field.type" @change="changeFieldType(field)"><option v-for="(label,type) in fieldTypes" :key="type" :value="type">{{ label }}</option></select></label><label><input v-model="field.required" type="checkbox" />必填</label><label><input v-model="field.translatable" type="checkbox" />按语言分别填写</label><template v-if="field.type==='select'"><div v-for="(option,position) in field.options" :key="position"><label>选项名称<input v-model="option.label" /></label><label>选项标识<input v-model="option.value" /></label><button type="button" class="secondary" @click="field.options!.splice(position,1)">删除选项</button></div><button type="button" class="secondary" @click="field.options!.push({value:`option${field.options!.length+1}`,label:'新选项'})">添加选项</button></template><template v-if="field.type==='table'"><div v-for="(column,position) in field.columns" :key="position"><label>列名称<input v-model="column.label" /></label><label>列标识<input v-model="column.key" /></label><select v-model="column.type"><option value="text">文字</option><option value="number">数字</option></select></div><button type="button" class="secondary" @click="field.columns!.push({key:`column${field.columns!.length+1}`,label:'新列',type:'text'})">添加列</button></template><label v-if="field.type==='reference'">关联内容类型<select v-model="field.referenceCollectionId"><option v-for="collection in collections" :key="collection.meta.collectionId" :value="collection.meta.collectionId">{{ collection.meta.name }}</option></select></label><button type="button" class="secondary" @click="editing.meta.fields.splice(index,1)">删除字段</button></article><button type="button" class="secondary" @click="addField">添加字段</button><button :disabled="busy">保存内容类型</button></form></template>
  <template v-else-if="settings">
    <form @submit.prevent="save">
      <template v-if="section==='general'">
        <label>网站名称<input v-model="settings.siteName" required /></label>
        <label>网站网址<input v-model="settings.siteUrl" type="url" /></label>
        <label>公司名称<input v-model="settings.company.name" /></label>
        <label>公司地址<input v-model="settings.company.address" /></label>
        <label>联系电话<input v-model="settings.company.phone" /></label>
        <label>联系邮箱<input v-model="settings.company.email" type="email" required /></label>
        <label>网站图标<select v-model="settings.iconMediaId"><option :value="null">未选择图标</option><option v-for="(item,index) in media" :key="item.mediaId" :value="item.mediaId">{{ mediaTitle(item,index) }}</option></select></label>
        <label>默认语言<select v-model="settings.defaultLocale"><option v-for="locale in settings.locales" :key="locale.code" :value="locale.code">{{ new Intl.DisplayNames(['zh-CN'],{type:'language'}).of(locale.code) }}</option></select></label>
        <h2>社交链接</h2>
        <div v-for="(link,index) in settings.socialLinks" :key="index"><label>平台名称<input v-model="link.platform" required /></label><label>平台网址<input v-model="link.url" type="url" required /></label><button type="button" class="secondary" @click="settings.socialLinks.splice(index,1)">删除链接</button></div>
        <button type="button" class="secondary" @click="settings.socialLinks.push({platform:'',url:'https://'})">添加社交链接</button>
      </template>
      <template v-else><label><input v-model="settings.search.allowIndexing" type="checkbox" />允许搜索引擎收录</label><label><input v-model="settings.search.allowAiSearch" type="checkbox" />允许 AI 搜索服务访问</label><label><input v-model="settings.search.allowAiTraining" type="checkbox" />允许 AI 训练服务访问</label></template>
      <button :disabled="busy">保存设置</button>
    </form>
    <form v-if="section==='general'" @submit.prevent="addLocale"><h2>添加语言</h2><p>添加语言将生成全部内容的语言副本和固定文字，翻译状态为待翻译。</p><label>语言代码<input v-model="localeCode" placeholder="例如 fr、ja、ar" required /></label><label>文字方向<select v-model="localeDir"><option value="ltr">从左向右</option><option value="rtl">从右向左</option></select></label><button :disabled="busy">添加语言</button></form>
  </template>
</section></template>
<style scoped>form{max-width:760px;margin-top:24px}label{display:grid;gap:7px;margin:14px 0}input:not([type=checkbox]),select{width:100%;padding:9px}article{padding:16px;margin:14px 0;border:1px solid #dbe2ea;border-radius:10px}button{margin:8px 10px 8px 0}</style>

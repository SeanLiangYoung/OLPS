<script setup lang="ts">
export type SettingField={key:string;type:string;label:string;required?:boolean;translatable?:boolean;default?:unknown;options?:Array<{value:string;label:string}>;itemFields?:SettingField[]}
type Medium={mediaId:string;originalName?:string;filename?:string;title?:Record<string,string>}
const props=defineProps<{fields:SettingField[];modelValue:Record<string,unknown>;media?:Medium[];locale?:string;configuredSecrets?:Record<string,boolean>}>()
const emit=defineEmits<{ 'update:modelValue':[Record<string,unknown>] }>()
const translated:Record<string,string>={primaryColor:'主要颜色',fontFamily:'字体',logo:'网站标志',footerText:'页脚文字',apiKey:'API 密钥',phone:'WhatsApp 电话号码',phoneNumber:'电话号码',buttonLabel:'按钮文字',defaultAddress:'默认地址',label:'显示文字',position:'显示位置',zoom:'地图缩放',latitude:'纬度',longitude:'经度'}
function label(field:SettingField){return field.key==='browserApiKey'?'地图浏览器公开 API key':translated[field.key]??field.label}
function value(field:SettingField):unknown{const current=props.modelValue[field.key]??field.default;if(field.translatable&&props.locale&&current&&typeof current==='object'&&!Array.isArray(current))return (current as Record<string,unknown>)[props.locale]??'';return current}
function update(field:SettingField,next:unknown){let result=next;if(field.translatable&&props.locale)result={...(typeof props.modelValue[field.key]==='object'?props.modelValue[field.key] as object:{}),[props.locale]:next};emit('update:modelValue',{...props.modelValue,[field.key]:result})}
function text(field:SettingField){return String(value(field)??'')}
function mediaId(field:SettingField){return (value(field) as {mediaId?:string}|undefined)?.mediaId??''}
function mediaIds(field:SettingField){return ((value(field)??[]) as Array<{mediaId:string}>).map(item=>item.mediaId)}
function linkUrl(field:SettingField){return (value(field) as {url?:string}|undefined)?.url??''}
function mediaLabel(item:Medium,index:number){return item.title?.[props.locale??'en']||Object.values(item.title??{}).find(Boolean)||`媒体文件 ${index+1}`}
const list=(field:SettingField)=>(value(field) as Record<string,unknown>[]|undefined)??[]
</script>
<template>
  <div class="settings-fields"><div v-for="field in fields" :key="field.key" class="setting-field"><label>{{ label(field) }}<span v-if="field.required">（必填）</span></label>
    <p v-if="field.key==='browserApiKey'">此 key 会写入公开网页。请在 Google Cloud 启用 Maps Embed API，并把 key 限制为本网站来源和 Maps Embed API。访客点击显示地图后才连接 Google。</p>
    <template v-if="field.type==='list'"><div v-for="(entry,index) in list(field)" :key="index" class="list-entry"><CmsSettingsFields :fields="field.itemFields??[]" :model-value="entry" :media="media" :locale="locale" @update:model-value="update(field,list(field).map((item,position)=>position===index?$event:item))" /><button type="button" class="secondary" @click="update(field,list(field).filter((_,position)=>position!==index))">删除此项</button></div><button type="button" class="secondary" @click="update(field,[...list(field),{}])">添加一项</button></template>
    <select v-else-if="field.type==='select'" :aria-label="label(field)" :value="text(field)" @change="update(field,($event.target as HTMLSelectElement).value)"><option value="">请选择</option><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.value==='bottom-right'?'右下角':option.value==='bottom-left'?'左下角':option.label }}</option></select>
    <input v-else-if="field.type==='boolean'" :aria-label="label(field)" type="checkbox" :checked="!!value(field)" @change="update(field,($event.target as HTMLInputElement).checked)" />
    <select v-else-if="field.type==='media'" :value="mediaId(field)" @change="update(field,($event.target as HTMLSelectElement).value?{mediaId:($event.target as HTMLSelectElement).value}:null)"><option value="">未选择媒体</option><option v-for="(item,index) in media" :key="item.mediaId" :value="item.mediaId">{{ mediaLabel(item,index) }}</option></select>
    <select v-else-if="field.type==='mediaList'" multiple :value="mediaIds(field)" @change="update(field,Array.from(($event.target as HTMLSelectElement).selectedOptions).map(option=>({mediaId:option.value})))"><option v-for="(item,index) in media" :key="item.mediaId" :value="item.mediaId">{{ mediaLabel(item,index) }}</option></select>
    <input v-else-if="field.type==='link'" type="url" placeholder="https://" :value="linkUrl(field)" @input="update(field,{kind:'external',url:($event.target as HTMLInputElement).value,newWindow:false})" />
    <textarea v-else-if="field.type==='richtext'" :aria-label="label(field)" :value="text(field)" @input="update(field,($event.target as HTMLTextAreaElement).value)" />
    <template v-else-if="field.type==='secret'"><p>{{ configuredSecrets?.[field.key]?'已经配置，填写新值可以更换':'尚未配置' }}</p><input :aria-label="label(field)" type="password" autocomplete="new-password" :value="text(field)" @input="update(field,($event.target as HTMLInputElement).value)" /><button v-if="configuredSecrets?.[field.key]" type="button" class="secondary" @click="update(field,null)">清除密钥</button></template>
    <input v-else :aria-label="label(field)" :type="field.type==='color'?'color':field.type==='number'?'number':'text'" :value="text(field)" :required="field.required" @input="update(field,field.type==='number'?Number(($event.target as HTMLInputElement).value):($event.target as HTMLInputElement).value)" />
  </div></div>
</template>
<style scoped>.setting-field{display:grid;gap:8px;margin:16px 0}.setting-field input:not([type=checkbox]),select,textarea{width:100%;padding:9px}.setting-field input[type=color]{height:44px}.list-entry{padding:12px;border:1px solid #dbe2ea;border-radius:8px}</style>

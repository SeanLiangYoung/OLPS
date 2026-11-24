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
function updateMediaList(field:SettingField,ids:string[]){update(field,ids.map(id=>({mediaId:id})))}
</script>
<template>
  <div class="settings-fields">
    <div v-for="field in fields" :key="field.key" class="setting-field">
      <el-form-item :label="`${label(field)}${field.required?'（必填）':''}`">
        <p v-if="field.key==='browserApiKey'" class="field-hint">此 key 会写入公开网页。请在 Google Cloud 启用 Maps Embed API，并把 key 限制为本网站来源和 Maps Embed API。访客点击显示地图后才连接 Google。</p>
        <template v-if="field.type==='list'">
          <el-card v-for="(entry,index) in list(field)" :key="index" class="list-entry" shadow="never">
            <CmsSettingsFields
              :fields="field.itemFields??[]"
              :model-value="entry"
              :media="media"
              :locale="locale"
              @update:model-value="update(field,list(field).map((item,position)=>position===index?$event:item))"
            />
            <el-button @click="update(field,list(field).filter((_,position)=>position!==index))">删除此项</el-button>
          </el-card>
          <el-button @click="update(field,[...list(field),{}])">添加一项</el-button>
        </template>
        <el-select
          v-else-if="field.type==='select'"
          :aria-label="label(field)"
          :model-value="text(field)"
          style="width:100%"
          @change="update(field,$event)"
        >
          <el-option value="" label="请选择" />
          <el-option
            v-for="option in field.options"
            :key="option.value"
            :value="option.value"
            :label="option.value==='bottom-right'?'右下角':option.value==='bottom-left'?'左下角':option.label"
          />
        </el-select>
        <el-switch
          v-else-if="field.type==='boolean'"
          :aria-label="label(field)"
          :model-value="!!value(field)"
          @change="update(field,$event)"
        />
        <el-select
          v-else-if="field.type==='media'"
          :model-value="mediaId(field)"
          clearable
          placeholder="未选择媒体"
          style="width:100%"
          @change="update(field,$event?{mediaId:$event}:null)"
        >
          <el-option value="" label="未选择媒体" />
          <el-option
            v-for="(item,index) in media"
            :key="item.mediaId"
            :value="item.mediaId"
            :label="mediaLabel(item,index)"
          />
        </el-select>
        <el-select
          v-else-if="field.type==='mediaList'"
          :model-value="mediaIds(field)"
          multiple
          style="width:100%"
          @change="updateMediaList(field,$event)"
        >
          <el-option
            v-for="(item,index) in media"
            :key="item.mediaId"
            :value="item.mediaId"
            :label="mediaLabel(item,index)"
          />
        </el-select>
        <el-input
          v-else-if="field.type==='link'"
          type="url"
          placeholder="https://"
          :model-value="linkUrl(field)"
          @input="update(field,{kind:'external',url:$event,newWindow:false})"
        />
        <el-input
          v-else-if="field.type==='richtext'"
          type="textarea"
          :rows="4"
          :aria-label="label(field)"
          :model-value="text(field)"
          @input="update(field,$event)"
        />
        <template v-else-if="field.type==='secret'">
          <p>{{ configuredSecrets?.[field.key]?'已经配置，填写新值可以更换':'尚未配置' }}</p>
          <el-input
            :aria-label="label(field)"
            type="password"
            autocomplete="new-password"
            show-password
            :model-value="text(field)"
            @input="update(field,$event)"
          />
          <el-button v-if="configuredSecrets?.[field.key]" class="secret-clear" @click="update(field,null)">清除密钥</el-button>
        </template>
        <el-input
          v-else-if="field.type==='color'"
          type="color"
          :aria-label="label(field)"
          :model-value="text(field)"
          :required="field.required"
          @input="update(field,$event)"
        />
        <el-input
          v-else
          :aria-label="label(field)"
          :type="field.type==='number'?'number':'text'"
          :model-value="text(field)"
          :required="field.required"
          @input="update(field,field.type==='number'?Number($event):$event)"
        />
      </el-form-item>
    </div>
  </div>
</template>
<style scoped>
.setting-field{margin:8px 0}
.field-hint{margin:0 0 8px;color:var(--el-text-color-secondary);font-size:13px;line-height:1.5}
.list-entry{margin-bottom:12px}
.secret-clear{margin-top:8px}
.setting-field :deep(.el-input__inner[type=color]){height:40px;padding:4px}
</style>

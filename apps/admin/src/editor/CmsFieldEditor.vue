<script setup lang="ts">
import { computed,ref,watch,onBeforeUnmount } from 'vue'
import type { BlockFieldDefinition,FieldDefinition,ContentRef } from '@olps/domain'
import type { SiteModel } from '@olps/render'
import { api } from '../api'
import FieldControl from './FieldControl.vue'
import { loadEditorResources,clearEditorResources,editorResourceRefreshDelay } from './resources'
import type { ResourceAccess } from './canvas'

const props=withDefaults(defineProps<{field:FieldDefinition|BlockFieldDefinition;modelValue:unknown;draftId:string;locale?:string}>(),{locale:'en'})
const emit=defineEmits<{(event:'update:modelValue',value:unknown):void}>()
const model=ref<SiteModel>()
const access=ref<ResourceAccess>()
const error=ref('')
let renewal:ReturnType<typeof setTimeout>|undefined
let epoch=0
const options=computed(()=>model.value?.collections.find(collection=>collection.definition.collectionId===('referenceCollectionId'in props.field?props.field.referenceCollectionId:undefined))?.items.filter(item=>item.locales[props.locale]).map(item=>({id:item.meta.itemId,title:item.locales[props.locale].title}))??[])
const links=computed(()=>model.value?.pages.filter(page=>page.locales[props.locale]).map(page=>({title:page.locales[props.locale].title,target:{ref:'page' as const,id:page.meta.pageId}}))??[])
const field=computed<BlockFieldDefinition>(()=>{
  if(props.field.type==='table')return {...props.field,type:'list',itemFields:props.field.columns?.map(column=>({key:column.key,label:column.label,type:column.type,required:true,translatable:true,default:column.type==='number'?0:''}))}
  return props.field as BlockFieldDefinition
})
async function load(invalidToken?:string):Promise<void>{
  const current=++epoch
  if(renewal)clearTimeout(renewal)
  try{
    const loaded=await loadEditorResources(props.draftId,invalidToken)
    if(current!==epoch)return
    model.value=loaded.model;access.value=loaded.access;error.value=''
    renewal=setTimeout(()=>{void load()},editorResourceRefreshDelay(loaded.access))
  }catch{if(current===epoch)error.value='字段资料暂时无法加载，请重新加载资料。'}
}
function resourceFailed(token:string):void{void load(token)}
watch(()=>props.draftId,()=>{void load()},{immediate:true})
onBeforeUnmount(()=>{epoch++;if(renewal)clearTimeout(renewal)})
async function upload(file:File):Promise<void>{
  error.value=''
  try{const body=new FormData();body.set('file',file);await api('POST',`/api/drafts/${encodeURIComponent(props.draftId)}/media`,body);clearEditorResources(props.draftId);await load()}catch{error.value='图片上传失败，请检查图片类型与大小。'}
}
</script>

<template>
  <p v-if="error" role="alert">{{ error }}</p>
  <button v-if="error" type="button" @click="load()">重新加载资料</button>
  <label v-if="props.field.type==='date'">{{ props.field.label }}<input type="date" :value="modelValue" @input="emit('update:modelValue',($event.target as HTMLInputElement).value||undefined)" /></label>
  <label v-else-if="props.field.type==='reference'">{{ props.field.label }}<select :value="(modelValue as ContentRef|null)?.id??''" @change="emit('update:modelValue',($event.target as HTMLSelectElement).value?{ref:'item',id:($event.target as HTMLSelectElement).value}:null)"><option value="">不选择</option><option v-for="item in options" :key="item.id" :value="item.id">{{ item.title }}</option></select></label>
  <FieldControl v-else-if="model&&access" :field="field" :model-value="modelValue" :media="model.media" :access="access" :locale="locale" :links="links" @update:model-value="emit('update:modelValue',$event)" @upload="upload" @resource-error="resourceFailed" />
  <p v-else-if="!error">正在加载字段资料…</p>
</template>

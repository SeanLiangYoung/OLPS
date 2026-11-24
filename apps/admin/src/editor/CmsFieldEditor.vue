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
function referenceId():string{return (props.modelValue as ContentRef|null)?.id??''}
watch(()=>props.draftId,()=>{void load()},{immediate:true})
onBeforeUnmount(()=>{epoch++;if(renewal)clearTimeout(renewal)})
async function upload(file:File):Promise<void>{
  error.value=''
  try{const body=new FormData();body.set('file',file);await api('POST',`/api/drafts/${encodeURIComponent(props.draftId)}/media`,body);clearEditorResources(props.draftId);await load()}catch{error.value='图片上传失败，请检查图片类型与大小。'}
}
</script>

<template>
  <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="field-alert" />
  <el-button v-if="error" @click="load()">重新加载资料</el-button>
  <el-form-item v-if="props.field.type==='date'" :label="props.field.label">
    <el-input
      type="date"
      :model-value="String(modelValue??'')"
      @input="emit('update:modelValue',$event||undefined)"
    />
  </el-form-item>
  <el-form-item v-else-if="props.field.type==='reference'" :label="props.field.label">
    <el-select
      :model-value="referenceId()"
      style="width:100%"
      @change="emit('update:modelValue',$event?{ref:'item',id:$event}:null)"
    >
      <el-option value="" label="不选择" />
      <el-option v-for="item in options" :key="item.id" :value="item.id" :label="item.title" />
    </el-select>
  </el-form-item>
  <FieldControl
    v-else-if="model&&access"
    :field="field"
    :model-value="modelValue"
    :media="model.media"
    :access="access"
    :locale="locale"
    :links="links"
    @update:model-value="emit('update:modelValue',$event)"
    @upload="upload"
    @resource-error="resourceFailed"
  />
  <p v-else-if="!error" class="muted">正在加载字段资料…</p>
</template>

<style scoped>
.field-alert{margin-bottom:8px}
.muted{color:var(--el-text-color-secondary)}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { BlockFieldDefinition,MediaMeta,ContentRef } from '@olps/domain'
import RichtextField from './RichtextField.vue'
import MediaPicker from './MediaPicker.vue'
import type { ResourceAccess } from './canvas'

const props=defineProps<{field:BlockFieldDefinition;modelValue:unknown;media:MediaMeta[];access:ResourceAccess;locale:string;links:Array<{target:ContentRef;title:string}>}>()
const emit=defineEmits<{(event:'update:modelValue',value:unknown):void;(event:'upload',file:File):void;(event:'resource-error',token:string):void}>()
const link=computed(()=>(props.modelValue&&typeof props.modelValue==='object'?props.modelValue:{kind:'external',url:'',newWindow:false}) as {kind:string;url?:string;newWindow?:boolean;target?:ContentRef})
const items=computed(()=>Array.isArray(props.modelValue)?props.modelValue as Array<Record<string,unknown>>:[])
const label=computed(()=>({Text:'文字',Content:'内容',Image:'图片',Images:'图片',Link:'链接',Label:'按钮文字',Title:'标题',Subtitle:'副标题',Color:'颜色',Columns:'栏目数量',Level:'标题层级'} as Record<string,string>)[props.field.label]??props.field.label)
function input(event:Event):void{const value=(event.target as HTMLInputElement).value;emit('update:modelValue',props.field.type==='select'&&value===''?undefined:value)}
function updateItem(index:number,key:string,value:unknown):void{emit('update:modelValue',items.value.map((item,current)=>current===index?{...item,[key]:value}:item))}
function addItem():void{const item:Record<string,unknown>={};for(const field of props.field.itemFields??[])if(field.default!==undefined)item[field.key]=JSON.parse(JSON.stringify(field.default));emit('update:modelValue',[...items.value,item])}
function selectLink(event:Event):void{const chosen=props.links[Number((event.target as HTMLSelectElement).value)];if(chosen)emit('update:modelValue',{kind:'internal',target:chosen.target})}
</script>

<template>
  <label v-if="field.type==='text'">{{ label }}<input :value="modelValue??''" @input="input" /></label>
  <label v-else-if="field.type==='number'">{{ label }}<input type="number" :value="modelValue" @input="emit('update:modelValue',($event.target as HTMLInputElement).value===''?undefined:($event.target as HTMLInputElement).valueAsNumber)" /></label>
  <label v-else-if="field.type==='boolean'"><input type="checkbox" :checked="Boolean(modelValue)" @change="emit('update:modelValue',($event.target as HTMLInputElement).checked)" />{{ label }}</label>
  <label v-else-if="field.type==='color'">{{ label }}<input type="color" :value="modelValue" @input="input" /></label>
  <label v-else-if="field.type==='select'">{{ label }}<select :value="modelValue??''" @change="input"><option value="" :disabled="field.required">{{ field.required?'请选择':'不选择' }}</option><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
  <RichtextField v-else-if="field.type==='richtext'" :label="label" :model-value="modelValue" @update:model-value="emit('update:modelValue',$event)" />
  <MediaPicker v-else-if="field.type==='media'||field.type==='mediaList'" :label="label" :multiple="field.type==='mediaList'" :model-value="modelValue" :media="media" :locale="locale" :access="access" @update:model-value="emit('update:modelValue',$event)" @upload="emit('upload',$event)" @resource-error="emit('resource-error',$event)" />
  <fieldset v-else-if="field.type==='link'">
    <legend>{{ label }}</legend>
    <label>链接位置<select :value="link.kind" @change="emit('update:modelValue',($event.target as HTMLSelectElement).value==='external'?{kind:'external',url:'https://',newWindow:false}:{kind:'internal',target:links[0]?.target})"><option value="external">其他网站</option><option value="internal">本站内容</option></select></label>
    <template v-if="link.kind==='external'"><label>网址<input :value="link.url" type="url" @input="emit('update:modelValue',{...link,url:($event.target as HTMLInputElement).value})" /></label><label><input type="checkbox" :checked="link.newWindow" @change="emit('update:modelValue',{...link,newWindow:($event.target as HTMLInputElement).checked})" />在新窗口打开</label></template>
    <label v-else>目标内容<select :value="links.findIndex(item=>item.target.ref===link.target?.ref&&item.target.id===link.target?.id)" @change="selectLink"><option value="-1" disabled>请选择内容</option><option v-for="(item,index) in links" :key="index" :value="index">{{ item.title }}</option></select></label>
  </fieldset>
  <fieldset v-else-if="field.type==='list'">
    <legend>{{ label }}</legend>
    <div v-for="(item,index) in items" :key="index" class="list-item"><FieldControl v-for="child in field.itemFields" :key="child.key" :field="child" :model-value="item[child.key]" :media="media" :access="access" :locale="locale" :links="links" @update:model-value="updateItem(index,child.key,$event)" @upload="emit('upload',$event)" @resource-error="emit('resource-error',$event)" /><button type="button" @click="emit('update:modelValue',items.filter((_,current)=>current!==index))">删除这一项</button></div>
    <button type="button" @click="addItem">添加一项</button>
  </fieldset>
</template>

<style scoped>
fieldset{border:1px solid var(--line,#ccd4db);border-radius:6px;padding:.7rem;display:grid;gap:.6rem;margin:.5rem 0}label{display:grid;gap:.35rem;margin:.45rem 0}.list-item{border-bottom:1px solid var(--line,#ccd4db);padding-bottom:.65rem}
</style>

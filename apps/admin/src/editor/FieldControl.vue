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
function input(value:string):void{emit('update:modelValue',props.field.type==='select'&&value===''?undefined:value)}
function updateItem(index:number,key:string,value:unknown):void{emit('update:modelValue',items.value.map((item,current)=>current===index?{...item,[key]:value}:item))}
function addItem():void{const item:Record<string,unknown>={};for(const field of props.field.itemFields??[])if(field.default!==undefined)item[field.key]=JSON.parse(JSON.stringify(field.default));emit('update:modelValue',[...items.value,item])}
function selectLink(index:number):void{const chosen=props.links[index];if(chosen)emit('update:modelValue',{kind:'internal',target:chosen.target})}
function linkIndex():number{return props.links.findIndex(item=>item.target.ref===link.value.target?.ref&&item.target.id===link.value.target?.id)}
</script>

<template>
  <el-form-item v-if="field.type==='text'" :label="label">
    <el-input :model-value="String(modelValue??'')" @input="input" />
  </el-form-item>
  <el-form-item v-else-if="field.type==='number'" :label="label">
    <el-input
      type="number"
      :model-value="modelValue === undefined || modelValue === null ? '' : String(modelValue)"
      @input="emit('update:modelValue',$event===''?undefined:Number($event))"
    />
  </el-form-item>
  <el-form-item v-else-if="field.type==='boolean'" :label="label">
    <el-switch :model-value="Boolean(modelValue)" @change="emit('update:modelValue',$event)" />
  </el-form-item>
  <el-form-item v-else-if="field.type==='color'" :label="label">
    <el-input type="color" :model-value="String(modelValue??'')" @input="input" />
  </el-form-item>
  <el-form-item v-else-if="field.type==='select'" :label="label">
    <el-select :model-value="modelValue??''" style="width:100%" @change="input">
      <el-option value="" :label="field.required?'请选择':'不选择'" :disabled="field.required" />
      <el-option v-for="option in field.options" :key="option.value" :value="option.value" :label="option.label" />
    </el-select>
  </el-form-item>
  <RichtextField v-else-if="field.type==='richtext'" :label="label" :model-value="modelValue" @update:model-value="emit('update:modelValue',$event)" />
  <MediaPicker
    v-else-if="field.type==='media'||field.type==='mediaList'"
    :label="label"
    :multiple="field.type==='mediaList'"
    :model-value="modelValue"
    :media="media"
    :locale="locale"
    :access="access"
    @update:model-value="emit('update:modelValue',$event)"
    @upload="emit('upload',$event)"
    @resource-error="emit('resource-error',$event)"
  />
  <el-card v-else-if="field.type==='link'" shadow="never" class="field-group">
    <template #header>{{ label }}</template>
    <el-form-item label="链接位置">
      <el-select
        :model-value="link.kind"
        style="width:100%"
        @change="emit('update:modelValue',$event==='external'?{kind:'external',url:'https://',newWindow:false}:{kind:'internal',target:links[0]?.target})"
      >
        <el-option value="external" label="其他网站" />
        <el-option value="internal" label="本站内容" />
      </el-select>
    </el-form-item>
    <template v-if="link.kind==='external'">
      <el-form-item label="网址">
        <el-input :model-value="link.url" type="url" @input="emit('update:modelValue',{...link,url:$event})" />
      </el-form-item>
      <el-form-item>
        <el-checkbox
          :model-value="link.newWindow"
          @change="emit('update:modelValue',{...link,newWindow:$event})"
        >在新窗口打开</el-checkbox>
      </el-form-item>
    </template>
    <el-form-item v-else label="目标内容">
      <el-select :model-value="linkIndex()" style="width:100%" @change="selectLink">
        <el-option :value="-1" label="请选择内容" disabled />
        <el-option v-for="(item,index) in links" :key="index" :value="index" :label="item.title" />
      </el-select>
    </el-form-item>
  </el-card>
  <el-card v-else-if="field.type==='list'" shadow="never" class="field-group">
    <template #header>{{ label }}</template>
    <div v-for="(item,index) in items" :key="index" class="list-item">
      <FieldControl
        v-for="child in field.itemFields"
        :key="child.key"
        :field="child"
        :model-value="item[child.key]"
        :media="media"
        :access="access"
        :locale="locale"
        :links="links"
        @update:model-value="updateItem(index,child.key,$event)"
        @upload="emit('upload',$event)"
        @resource-error="emit('resource-error',$event)"
      />
      <el-button @click="emit('update:modelValue',items.filter((_,current)=>current!==index))">删除这一项</el-button>
    </div>
    <el-button @click="addItem">添加一项</el-button>
  </el-card>
</template>

<style scoped>
.field-group{margin:.5rem 0}
.list-item{border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:.65rem;margin-bottom:.65rem}
</style>

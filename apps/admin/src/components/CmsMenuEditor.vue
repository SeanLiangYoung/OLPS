<script setup lang="ts">
import draggable from 'vuedraggable'
import type { MenuItem } from '@olps/domain'
const props=defineProps<{modelValue:MenuItem[];locale:string;targets:Array<{ref:'page'|'collection'|'group'|'item';id:string;title:string}>}>()
const emit=defineEmits<{'update:modelValue':[MenuItem[]]}>()
function add(){const target=props.targets[0];emit('update:modelValue',[...props.modelValue,{menuItemId:crypto.randomUUID(),label:{[props.locale]:'新菜单项目'},link:target?{kind:'internal',target:{ref:target.ref,id:target.id}}:{kind:'external',url:'https://example.com',newWindow:false},children:[]}])}
function select(item:MenuItem,value:string){const target=props.targets.find(target=>`${target.ref}:${target.id}`===value);if(target)item.link={kind:'internal',target:{ref:target.ref,id:target.id}}}
function targetValue(item:MenuItem){return item.link.kind==='internal'?`${item.link.target.ref}:${item.link.target.id}`:''}
function external(item:MenuItem){item.link={kind:'external',url:'https://',newWindow:false}}
</script>
<template>
  <div class="menu-editor">
    <draggable
      :model-value="modelValue"
      item-key="menuItemId"
      group="website-menu"
      handle=".drag-handle"
      @update:model-value="emit('update:modelValue',$event)"
    >
      <template #item="{element:item}">
        <el-card class="menu-item" shadow="never">
          <el-button class="drag-handle" aria-label="拖动菜单项目">拖动排序</el-button>
          <el-form-item label="菜单文字" required>
            <el-input v-model="item.label[locale]" required />
          </el-form-item>
          <el-form-item label="网站内容">
            <el-select
              :model-value="targetValue(item)"
              style="width:100%"
              @change="select(item,$event)"
            >
              <el-option value="" label="选择网站内容" />
              <el-option
                v-for="target in targets"
                :key="`${target.ref}:${target.id}`"
                :value="`${target.ref}:${target.id}`"
                :label="target.title"
              />
            </el-select>
          </el-form-item>
          <el-button v-if="item.link.kind==='internal'" @click="external(item)">改为外部链接</el-button>
          <template v-if="item.link.kind==='external'">
            <el-form-item label="外部网址" required>
              <el-input v-model="item.link.url" type="url" required />
            </el-form-item>
            <el-form-item>
              <el-checkbox v-model="item.link.newWindow">在新窗口打开</el-checkbox>
            </el-form-item>
          </template>
          <el-button @click="emit('update:modelValue',modelValue.filter(entry=>entry.menuItemId!==item.menuItemId))">删除菜单项目</el-button>
          <CmsMenuEditor v-model="item.children" :locale="locale" :targets="targets" />
        </el-card>
      </template>
    </draggable>
    <el-button class="add-item" @click="add">添加菜单项目</el-button>
  </div>
</template>
<style scoped>
.menu-item{margin:12px 0}
.menu-editor .menu-editor{margin-left:20px}
.drag-handle{margin-bottom:10px;cursor:grab}
.add-item{margin-top:8px}
</style>

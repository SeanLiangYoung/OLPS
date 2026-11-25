<script setup lang="ts">
import Draggable from 'vuedraggable'
import type { BlockNode } from '@olps/domain'
import type { RegisteredBlock } from './types'

const props=defineProps<{blocks:BlockNode[];definitions:RegisteredBlock[];selectedId:string}>()
const emit=defineEmits<{(event:'update',blocks:BlockNode[]):void;(event:'select',id:string):void}>()
function label(block:BlockNode):string{
  const text=block.props.text??block.props.title
  if(typeof text==='string'&&text)return text
  const core:Record<string,string>={'core/heading':'标题','core/text':'文字','core/image':'图片','core/video':'视频','core/button':'按钮','core/columns':'多栏内容','core/html':'自定义内容','core/faq':'常见问题','core/collection-list':'内容列表'}
  return core[block.type]??props.definitions.find(definition=>definition.type===block.type)?.name??'内容区域'
}
function childrenChanged(id:string,children:BlockNode[]):void{emit('update',props.blocks.map(block=>block.id===id?{...block,children}:block))}
</script>

<template>
  <Draggable
    :model-value="blocks"
    group="editor-blocks"
    item-key="id"
    handle=".block-drag"
    :animation="120"
    @update:model-value="emit('update',$event)"
  >
    <template #item="{element}">
      <div class="outline-item">
        <el-button
          class="block-drag"
          text
          :type="selectedId===element.id?'primary':'default'"
          @click="emit('select',element.id)"
        >{{ label(element) }}</el-button>
        <BlockOutline
          v-if="definitions.find(definition=>definition.type===element.type)?.accepts.length"
          :blocks="element.children"
          :definitions="definitions"
          :selected-id="selectedId"
          @update="childrenChanged(element.id,$event)"
          @select="emit('select',$event)"
        />
      </div>
    </template>
  </Draggable>
</template>

<style scoped>
.outline-item{padding:.2rem 0 .2rem .45rem;border-left:2px solid var(--el-border-color)}
.block-drag{width:100%;justify-content:flex-start;padding:.45rem}
</style>

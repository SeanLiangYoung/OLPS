<script setup lang="ts">
import draggable from 'vuedraggable'
export type GroupTreeNode = { id: string; title: string; children: GroupTreeNode[] }
defineProps<{ nodes: GroupTreeNode[]; parentId: string | null }>()
const emit = defineEmits<{ (event: 'reorder', value: { parentId: string | null; ids: string[] }): void; (event: 'edit', id: string): void }>()
</script>
<template>
  <draggable :model-value="nodes" item-key="id" handle=".cms-group-handle" tag="ul" class="cms-group-tree" @update:model-value="emit('reorder',{parentId,ids:($event as GroupTreeNode[]).map(node=>node.id)})">
    <template #item="{ element }"><li><div class="row"><button class="quiet cms-group-handle" aria-label="拖动分组排序">↕</button><button class="quiet" @click="emit('edit',element.id)">{{ element.title }}</button></div><CmsGroupTree v-if="element.children.length" :nodes="element.children" :parent-id="element.id" @reorder="emit('reorder',$event)" @edit="emit('edit',$event)" /></li></template>
  </draggable>
</template>
<style scoped>.cms-group-tree{list-style:none;padding-left:22px}.cms-group-tree>li{margin:4px 0}.cms-group-handle{cursor:grab}.cms-group-tree .row{border:1px solid var(--line);border-radius:6px;background:white;padding:4px}</style>

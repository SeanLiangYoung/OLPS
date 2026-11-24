<script setup lang="ts">
import draggable from 'vuedraggable'
export type GroupTreeNode = { id: string; title: string; children: GroupTreeNode[] }
defineProps<{ nodes: GroupTreeNode[]; parentId: string | null }>()
const emit = defineEmits<{ (event: 'reorder', value: { parentId: string | null; ids: string[] }): void; (event: 'edit', id: string): void }>()
</script>
<template>
  <draggable
    :model-value="nodes"
    item-key="id"
    handle=".cms-group-handle"
    tag="ul"
    class="cms-group-tree"
    @update:model-value="emit('reorder',{parentId,ids:($event as GroupTreeNode[]).map(node=>node.id)})"
  >
    <template #item="{ element }">
      <li>
        <div class="row">
          <el-button class="cms-group-handle" text aria-label="拖动分组排序">↕</el-button>
          <el-button text type="primary" @click="emit('edit',element.id)">{{ element.title }}</el-button>
        </div>
        <CmsGroupTree
          v-if="element.children.length"
          :nodes="element.children"
          :parent-id="element.id"
          @reorder="emit('reorder',$event)"
          @edit="emit('edit',$event)"
        />
      </li>
    </template>
  </draggable>
</template>
<style scoped>
.cms-group-tree{list-style:none;padding-left:22px}
.cms-group-tree>li{margin:4px 0}
.cms-group-handle{cursor:grab}
.cms-group-tree .row{
  display:flex;
  align-items:center;
  gap:4px;
  border:1px solid var(--el-border-color);
  border-radius:var(--el-border-radius-base);
  background:var(--el-bg-color);
  padding:4px 8px;
}
</style>

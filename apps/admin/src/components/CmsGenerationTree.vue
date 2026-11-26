<script setup lang="ts">
import type { GenerationNode } from '../cms-generation'

const props = defineProps<{
  nodes: GenerationNode[]
  disabled?: boolean
  collections?: Array<{ id: string; title: string }>
}>()

function addChild(node: GenerationNode): void {
  node.children ??= []
  node.children.push({
    nodeId: crypto.randomUUID(),
    ref: node.ref === 'collection' ? 'item' : 'page',
    collectionId: node.ref === 'collection' ? node.nodeId : undefined,
    title: '新内容',
    requirements: '',
    children: [],
  })
}

function removeNode(target: GenerationNode, list: GenerationNode[] = props.nodes): boolean {
  const index = list.findIndex((node) => node.nodeId === target.nodeId)
  if (index >= 0) {
    list.splice(index, 1)
    return true
  }
  for (const node of list) {
    if (node.children?.length && removeNode(target, node.children)) return true
  }
  return false
}
</script>
<template>
  <div class="generation-tree">
    <el-table
      :data="nodes"
      row-key="nodeId"
      default-expand-all
      height="100%"
      :tree-props="{ children: 'children' }"
      style="width: 100%"
      class="generation-tree-table"
      empty-text="还没有结构节点，可以先规划网站结构或手动添加内容。"
    >
      <el-table-column label="内容名称" width="180">
        <template #default="{ row }">
          <el-input v-model="row.title" class="title-input" :disabled="disabled" />
        </template>
      </el-table-column>
      <el-table-column label="内容类型" width="150">
        <template #default="{ row }">
          <el-select v-model="row.ref" :disabled="disabled" style="width: 100%">
            <el-option value="page" label="页面" />
            <el-option value="collection" label="内容列表" />
            <el-option value="group" label="内容分组" />
            <el-option value="item" label="内容条目" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="所属内容列表" width="180">
        <template #default="{ row }">
          <el-select
            v-if="row.ref === 'group' || row.ref === 'item'"
            v-model="row.collectionId"
            :disabled="disabled"
            style="width: 100%"
          >
            <el-option value="" label="请选择" />
            <el-option
              v-for="collection in collections"
              :key="collection.id"
              :value="collection.id"
              :label="collection.title"
            />
          </el-select>
          <span v-else class="cell-empty">—</span>
        </template>
      </el-table-column>
      <el-table-column label="内容要求" min-width="280">
        <template #default="{ row }">
          <el-input v-model="row.requirements" type="textarea" :rows="3" :disabled="disabled" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <div class="row-actions">
            <el-button link type="primary" :disabled="disabled" @click="addChild(row)">添加下级</el-button>
            <el-button link type="danger" :disabled="disabled" @click="removeNode(row)">移除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
<style scoped>
.generation-tree {
  height: 100%;
  min-height: 0;
}
.generation-tree-table {
  height: 100%;
}
.generation-tree-table :deep(.el-table__cell) {
  vertical-align: top;
}
/* 展开箭头与名称输入框同一行：避免 el-input 块级占满导致换行 */
.generation-tree-table :deep(.el-table__body .el-table__cell:first-child .cell) {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
}
.generation-tree-table :deep(.el-table__body .el-table__cell:first-child .el-table__expand-icon) {
  flex: 0 0 auto;
}
.title-input {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 140px;
}
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.cell-empty {
  color: var(--el-text-color-placeholder);
}
</style>


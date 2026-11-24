<script setup lang="ts">
import type { GenerationNode } from '../cms-generation'
const props=defineProps<{nodes:GenerationNode[];disabled?:boolean;collections?:Array<{id:string;title:string}>}>()
function addChild(node:GenerationNode){node.children??=[];node.children.push({nodeId:crypto.randomUUID(),ref:node.ref==='collection'?'item':'page',collectionId:node.ref==='collection'?node.nodeId:undefined,title:'新内容',requirements:'',children:[]})}
function remove(index:number){props.nodes.splice(index,1)}
</script>
<template>
  <ul class="generation-tree">
    <li v-for="(node,index) in nodes" :key="node.nodeId">
      <el-card shadow="never" class="node-card" :class="{disabled}">
        <template #header>
          <span>{{ node.title || '新内容' }}</span>
        </template>
        <el-form label-position="top" :disabled="disabled">
          <el-form-item label="内容名称">
            <el-input v-model="node.title" />
          </el-form-item>
          <el-form-item label="内容类型">
            <el-select v-model="node.ref" style="width:100%">
              <el-option value="page" label="页面" />
              <el-option value="collection" label="内容列表" />
              <el-option value="group" label="内容分组" />
              <el-option value="item" label="内容条目" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="node.ref === 'group' || node.ref === 'item'" label="所属内容列表">
            <el-select v-model="node.collectionId" style="width:100%">
              <el-option value="" label="请选择" />
              <el-option
                v-for="collection in collections"
                :key="collection.id"
                :value="collection.id"
                :label="collection.title"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="内容要求">
            <el-input v-model="node.requirements" type="textarea" :rows="2" />
          </el-form-item>
          <div class="row">
            <el-button :disabled="disabled" @click="addChild(node)">添加下级内容</el-button>
            <el-button :disabled="disabled" @click="remove(index)">移除此项</el-button>
          </div>
        </el-form>
      </el-card>
      <CmsGenerationTree
        v-if="node.children?.length"
        :nodes="node.children"
        :disabled="disabled"
        :collections="collections"
      />
    </li>
  </ul>
</template>
<style scoped>
.generation-tree{list-style:none;padding-left:1rem}
.node-card{margin:1rem 0}
.node-card.disabled{opacity:.7}
.row{display:flex;flex-wrap:wrap;gap:8px}
</style>

<script setup lang="ts">
import type { GenerationNode } from '../cms-generation'
const props=defineProps<{nodes:GenerationNode[];disabled?:boolean;collections?:Array<{id:string;title:string}>}>()
function addChild(node:GenerationNode){node.children??=[];node.children.push({nodeId:crypto.randomUUID(),ref:node.ref==='collection'?'item':'page',collectionId:node.ref==='collection'?node.nodeId:undefined,title:'新内容',requirements:'',children:[]})}
function remove(index:number){props.nodes.splice(index,1)}
</script>
<template>
  <ul class="generation-tree">
    <li v-for="(node,index) in nodes" :key="node.nodeId">
      <fieldset :disabled="disabled"><legend>{{ node.title || '新内容' }}</legend>
        <label>内容名称<input v-model="node.title" /></label>
        <label>内容类型<select v-model="node.ref"><option value="page">页面</option><option value="collection">内容列表</option><option value="group">内容分组</option><option value="item">内容条目</option></select></label>
        <label v-if="node.ref === 'group' || node.ref === 'item'">所属内容列表<select v-model="node.collectionId"><option value="">请选择</option><option v-for="collection in collections" :key="collection.id" :value="collection.id">{{ collection.title }}</option></select></label>
        <label>内容要求<textarea v-model="node.requirements" rows="2" /></label>
        <div class="row"><button type="button" class="secondary" @click="addChild(node)">添加下级内容</button><button type="button" class="secondary" @click="remove(index)">移除此项</button></div>
      </fieldset>
      <CmsGenerationTree v-if="node.children?.length" :nodes="node.children" :disabled="disabled" :collections="collections" />
    </li>
  </ul>
</template>
<style scoped>.generation-tree{list-style:none;padding-left:1rem}.generation-tree fieldset{border:1px solid var(--line);border-radius:.5rem;margin:1rem 0;padding:1rem}.generation-tree legend{padding:0 .5rem}</style>

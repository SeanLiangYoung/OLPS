<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { selectedSiteIdState } from '../workspaceSession'
import type { CmsSite } from '../cms-state'

type Document = { documentId: string; title: string; content: string }
const documents = ref<Document[]>([])
const sites = ref<CmsSite[]>([])
const title = ref('')
const content = ref('')
const editing = ref('')
const targets = ref<string[]>([])
const copying = ref<Document | null>(null)
const deleting = ref<Document | null>(null)
const error = ref('')
const message = ref('')
const busy = ref(false)
const base = () => `/api/sites/${selectedSiteIdState.value}/knowledge-base/documents`
async function load(): Promise<void> { documents.value = (await api<{ documents: Document[] }>('GET', base())).documents }
onMounted(async () => { try { await load(); sites.value = (await api<{ sites: CmsSite[] }>('GET', '/api/sites')).sites.filter(site => site.siteId !== selectedSiteIdState.value) } catch (reason) { error.value = (reason as Error).message } })
function edit(document: Document): void { editing.value = document.documentId; title.value = document.title; content.value = document.content }
function clear(): void { editing.value = ''; title.value = ''; content.value = '' }
async function save(): Promise<void> {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try { await api(editing.value ? 'PUT' : 'POST', editing.value ? `${base()}/${editing.value}` : base(), { title: title.value, content: content.value }); clear(); await load(); message.value = '资料已保存' } catch (reason) { error.value = (reason as Error).message } finally { busy.value = false }
}
async function remove(): Promise<void> { if (!deleting.value) return; try { await api('DELETE', `${base()}/${deleting.value.documentId}`); deleting.value = null; await load() } catch (reason) { error.value = (reason as Error).message } }
async function copy(): Promise<void> { if (!copying.value || !targets.value.length) return; try { await api('POST', `${base()}/${copying.value.documentId}/copy`, { targetSiteIds: targets.value }); copying.value = null; targets.value = []; message.value = '资料已复制到所选网站' } catch (reason) { error.value = (reason as Error).message } }
</script>
<template>
  <section><h1>网站资料</h1><p>添加公司介绍、产品资料和常见问题，供 AI 生成网站内容时使用。</p><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
    <div class="cms-knowledge-layout"><section class="panel"><h2>{{ editing ? '编辑资料' : '添加资料' }}</h2><form @submit.prevent="save"><label>资料标题<input v-model="title" required></label><label>资料正文<textarea v-model="content" rows="14" required></textarea></label><div class="row"><button :disabled="busy">{{ busy ? '正在保存…' : '保存资料' }}</button><button v-if="editing" class="secondary" type="button" @click="clear">取消编辑</button></div></form></section>
      <section class="panel"><h2>已有资料</h2><article v-for="document in documents" :key="document.documentId"><h3>{{ document.title }}</h3><p>{{ document.content.slice(0,180) }}</p><div class="row"><button class="secondary" @click="edit(document)">编辑</button><button class="secondary" @click="copying = document">复制到其他网站</button><button class="secondary" @click="deleting = document">删除</button></div></article><p v-if="!documents.length">尚未添加资料。</p></section></div>
    <dialog :open="!!copying" aria-label="复制网站资料"><h2>复制资料</h2><p>每个目标网站会保存独立资料，后续可分别编辑。</p><label v-for="site in sites" :key="site.siteId"><input v-model="targets" type="checkbox" :value="site.siteId">{{ site.name }}</label><p v-if="!sites.length">没有其他可管理的网站。</p><div class="row"><button :disabled="!targets.length" @click="copy">确认复制</button><button class="secondary" @click="copying = null">取消</button></div></dialog>
    <dialog :open="!!deleting" aria-label="删除资料确认"><p>确认删除「{{ deleting?.title }}」？</p><button @click="remove">确认删除</button><button class="secondary" @click="deleting = null">取消</button></dialog>
  </section>
</template>
<style scoped>.cms-knowledge-layout{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{padding-bottom:20px;border-bottom:1px solid var(--line)}@media(max-width:800px){.cms-knowledge-layout{grid-template-columns:1fr}}</style>

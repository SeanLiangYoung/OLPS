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
function closeCopy(): void { copying.value = null; targets.value = [] }
function closeDelete(): void { deleting.value = null }
</script>
<template>
  <section>
    <h1>网站资料</h1>
    <p>添加公司介绍、产品资料和常见问题，供 AI 生成网站内容时使用。</p>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-alert" />
    <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="page-alert" />
    <div class="cms-knowledge-layout">
      <el-card shadow="never">
        <template #header><span>{{ editing ? '编辑资料' : '添加资料' }}</span></template>
        <el-form label-position="top" @submit.prevent="save">
          <el-form-item label="资料标题" required>
            <el-input v-model="title" required />
          </el-form-item>
          <el-form-item label="资料正文" required>
            <el-input v-model="content" type="textarea" :rows="14" required />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="busy" native-type="submit">{{ busy ? '正在保存…' : '保存资料' }}</el-button>
            <el-button v-if="editing" @click="clear">取消编辑</el-button>
          </el-form-item>
        </el-form>
      </el-card>
      <el-card shadow="never">
        <template #header><span>已有资料</span></template>
        <article v-for="document in documents" :key="document.documentId" class="document-item">
          <h3>{{ document.title }}</h3>
          <p>{{ document.content.slice(0,180) }}</p>
          <div class="row">
            <el-button @click="edit(document)">编辑</el-button>
            <el-button @click="copying = document">复制到其他网站</el-button>
            <el-button type="danger" plain @click="deleting = document">删除</el-button>
          </div>
        </article>
        <el-empty v-if="!documents.length" description="尚未添加资料。" :image-size="72" />
      </el-card>
    </div>
    <el-dialog :model-value="!!copying" title="复制资料" width="480px" @update:model-value="(open: boolean) => { if (!open) closeCopy() }">
      <p>每个目标网站会保存独立资料，后续可分别编辑。</p>
      <el-checkbox-group v-model="targets" class="site-targets">
        <el-checkbox v-for="site in sites" :key="site.siteId" :label="site.siteId">{{ site.name }}</el-checkbox>
      </el-checkbox-group>
      <el-empty v-if="!sites.length" description="没有其他可管理的网站。" :image-size="64" />
      <template #footer>
        <el-button type="primary" :disabled="!targets.length" @click="copy">确认复制</el-button>
        <el-button @click="closeCopy">取消</el-button>
      </template>
    </el-dialog>
    <el-dialog :model-value="!!deleting" title="删除资料确认" width="420px" @update:model-value="(open: boolean) => { if (!open) closeDelete() }">
      <p>确认删除「{{ deleting?.title }}」？</p>
      <template #footer>
        <el-button type="danger" @click="remove">确认删除</el-button>
        <el-button @click="closeDelete">取消</el-button>
      </template>
    </el-dialog>
  </section>
</template>
<style scoped>
.page-alert { margin-bottom: 12px; }
.cms-knowledge-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.document-item { padding-bottom: 20px; border-bottom: 1px solid var(--el-border-color-lighter); margin-bottom: 16px; }
.document-item:last-child { border-bottom: 0; margin-bottom: 0; }
.document-item h3 { margin-top: 0; }
.site-targets { display: grid; gap: 8px; }
@media (max-width: 800px) { .cms-knowledge-layout { grid-template-columns: 1fr; } }
</style>

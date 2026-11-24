<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FieldDefinition } from '@olps/domain'
import { api, ApiError, getSelectedDraftId } from '../api'
import { contentLocale } from '../cms-state'
import { selectedDraftIdState } from '../workspaceSession'
import CmsFieldEditor from '../editor/CmsFieldEditor.vue'
import CmsGroupTree, { type GroupTreeNode } from '../components/CmsGroupTree.vue'

type Content = { ref: 'page' | 'collection' | 'group' | 'item'; meta: Record<string, unknown>; locale: { locale: string; title: string; slug?: string; fields?: Record<string, unknown> }; collectionId?: string }
const route = useRoute(); const router = useRouter()
const tab = ref<'items' | 'groups' | 'index'>('items')
const collectionId = computed(() => String(route.params.collectionId ?? ''))
const kind = computed<Content['ref']>(() => route.path === '/pages' ? 'page' : !collectionId.value || tab.value === 'index' ? 'collection' : tab.value === 'groups' ? 'group' : 'item')
const labels = { page: '页面', collection: '内容类型', group: '分组', item: '条目' }
const records = ref<Content[]>([]); const groups = ref<Content[]>([])
const definition = ref<Content | null>(null); const definitionRevision = ref('')
const query = ref(''); const status = ref(''); const cursor = ref<string | null>(null)
const error = ref(''); const message = ref(''); const busy = ref(false); const loading = ref(false)
const creating = ref(false); const deleting = ref<Content | null>(null)
const title = ref(''); const slug = ref(''); const parentId = ref(''); const chosenGroups = ref<string[]>([])
const fields = ref<Record<string, unknown>>({})
let generation=0
onUnmounted(()=>{generation++})
const customFields = computed(() => kind.value === 'item' ? (definition.value?.meta.fields as FieldDefinition[] | undefined) ?? [] : [])
const levels = computed(() => (definition.value?.meta.levels as Array<{ levelId: string; name: string }> | undefined) ?? [])
const draftId = computed(() => selectedDraftIdState.value)
const id = (entry: Content) => String(entry.meta[`${entry.ref}Id`])
const base = computed(() => `/api/drafts/${getSelectedDraftId()}/${kind.value === 'page' ? 'pages' : kind.value === 'collection' ? 'collections' : `collections/${collectionId.value}/${kind.value === 'group' ? 'groups' : 'items'}`}`)
const deleteVisible = computed({
  get: () => !!deleting.value,
  set: (value: boolean) => { if (!value) deleting.value = null },
})

async function load(append = false): Promise<void> {
  const version=++generation
  const selectedCollection=collectionId.value,selectedKind=kind.value,selectedLocale=contentLocale.value,selectedDraft=getSelectedDraftId(),endpoint=base.value
  error.value = ''
  if (!append) loading.value = true
  try {
    const params = new URLSearchParams({ locale: selectedLocale, limit: '100' })
    if (query.value.trim()) params.set('q', query.value.trim())
    if (status.value) params.set('status', status.value)
    if (append && cursor.value) params.set('cursor', cursor.value)
    let current:{content:Content;revision:string}|null=null
    const allGroups:Content[]=[]
    if (selectedCollection) {
      current = await api<{ content: Content; revision: string }>('GET', `/api/drafts/${selectedDraft}/content/collection/${selectedCollection}?locale=${selectedLocale}`)
      let next:string|null=null
      do{
        const groupParams=new URLSearchParams({locale:selectedLocale,limit:'100'})
        if(next)groupParams.set('cursor',next)
        const result=await api<{groups:Content[];pageInfo:{nextCursor:string|null}}>('GET',`/api/drafts/${selectedDraft}/collections/${selectedCollection}/groups?${groupParams}`)
        if(version!==generation)return
        allGroups.push(...result.groups);next=result.pageInfo.nextCursor
      }while(next)
    }
    if(version!==generation)return
    definition.value=current?.content??null;definitionRevision.value=current?.revision??'';groups.value=allGroups
    if (selectedCollection && selectedKind === 'collection') { records.value = current ? [current.content] : []; cursor.value = null; return }
    const result = await api<Record<string, Content[]> & { pageInfo: { nextCursor: string | null } }>('GET', `${endpoint}?${params}`)
    if(version!==generation)return
    const key = selectedKind === 'page' ? 'pages' : selectedKind === 'collection' ? 'collections' : selectedKind === 'group' ? 'groups' : 'items'
    records.value = append ? [...records.value, ...result[key]] : result[key]
    cursor.value = result.pageInfo.nextCursor
  } catch (reason) { if(version===generation)error.value = (reason as Error).message }
  finally { if (version === generation && !append) loading.value = false }
}
watch([() => route.path, tab, contentLocale, selectedDraftIdState], () => { cursor.value = null; void load() }, { immediate: true })
function edit(entry: Content): void { void router.push({ path: `/content/${entry.ref}/${id(entry)}`, query: { locale: contentLocale.value, ...(collectionId.value ? { collectionId: collectionId.value } : {}) } }) }
function editGroup(groupId: string): void { const entry = groups.value.find(group => id(group) === groupId); if (entry) edit(entry) }
function tree(parent: string | null = null): GroupTreeNode[] { return groups.value.filter(group => (group.meta.parentGroupId ?? null) === parent).sort((a,b) => Number(a.meta.order)-Number(b.meta.order)).map(group => ({ id: id(group), title: group.locale.title, children: tree(id(group)) })) }
function openCreate(): void { title.value = ''; slug.value = ''; parentId.value = ''; chosenGroups.value = []; fields.value = {}; creating.value = true }
async function create(): Promise<void> {
  if (busy.value) return
  const version = generation
  const selectedKind = kind.value, selectedLocale = contentLocale.value, selectedCollection = collectionId.value, selectedDraft = getSelectedDraftId(), endpoint = base.value
  const contextUnchanged = () => version === generation && kind.value === selectedKind && contentLocale.value === selectedLocale && collectionId.value === selectedCollection && getSelectedDraftId() === selectedDraft
  busy.value = true; error.value = ''
  try {
    const now = new Date().toISOString(); const contentId = crypto.randomUUID()
    const common = { schemaVersion: 1, status: 'draft', createdAt: now, updatedAt: now }
    let meta: Record<string, unknown>
    if (kind.value === 'page') meta = { ...common, pageId: contentId, role: null, template: 'page' }
    else if (kind.value === 'collection') meta = { ...common, collectionId: contentId, name: title.value, labels: { [contentLocale.value]: title.value }, prefix: slug.value, levels: [], fields: [], structuredData: null, feed: false }
    else if (kind.value === 'group') {
      const parent = groups.value.find(group => id(group) === parentId.value)
      const next = parent ? levels.value.findIndex(level => level.levelId === parent.meta.levelId) + 1 : 0
      if (!levels.value[next]) throw new Error('当前内容类型没有可用的分组层级')
      meta = { ...common, groupId: contentId, parentGroupId: parentId.value || null, levelId: levels.value[next].levelId, order: groups.value.length }
    } else meta = { ...common, itemId: contentId, primaryGroupId: chosenGroups.value[0] ?? null, groupIds: [...chosenGroups.value], order: records.value.length, publishedAt: null, fields: Object.fromEntries(customFields.value.filter(field => !field.translatable).map(field => [field.key, fields.value[field.key] ?? null])) }
    const locale = { schemaVersion: 1, locale: contentLocale.value, ...(kind.value === 'collection' ? {} : { slug: slug.value }), title: title.value, summary: '', cover: null, seo: { title: title.value, description: '', ogImage: null }, blocks: [{ id: crypto.randomUUID(), type: 'core/text', props: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title.value }] }] } }, children: [] }], sourceHash: null, updatedAt: now, ...(kind.value === 'item' ? { fields: Object.fromEntries(customFields.value.filter(field => field.translatable).map(field => [field.key, fields.value[field.key] ?? null])) } : {}) }
    const response = await api<Record<string, Content>>('POST', endpoint, { ref: selectedKind, meta, locale, ...(selectedCollection ? { collectionId: selectedCollection } : {}) })
    if (!contextUnchanged()) return
    creating.value = false
    const entry = response[selectedKind]
    await router.push({ path: `/content/${entry.ref}/${id(entry)}`, query: { locale: selectedLocale, ...(selectedCollection ? { collectionId: selectedCollection } : {}) } })
  } catch (reason) { if (contextUnchanged()) error.value = (reason as Error).message } finally { busy.value = false }
}
async function remove(): Promise<void> {
  if (!deleting.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const entry = deleting.value
    const endpoint = `/api/drafts/${getSelectedDraftId()}/content/${entry.ref}/${id(entry)}?locale=${contentLocale.value}`
    const current = await api<{ revision: string }>('GET', endpoint)
    await api('DELETE', endpoint, undefined, { headers: { 'If-Match': `"${current.revision}"` } })
    deleting.value = null; await load(); message.value = '内容已删除'
  } catch (reason) { error.value = reason instanceof ApiError && reason.status === 409 ? '此内容仍被其他位置引用，请修改引用后删除。' : (reason as Error).message } finally { busy.value = false }
}
async function reorder(value: { parentId: string | null; ids: string[] }): Promise<void> {
  try {
    await api('POST', `/api/drafts/${getSelectedDraftId()}/collections/${collectionId.value}/reorder`, { ref: 'group', locale: contentLocale.value, revision: definitionRevision.value, orders: value.ids.map((groupId, order) => ({ id: groupId, order })) })
    await load(); message.value = '分组顺序已保存'
  } catch (reason) { error.value = (reason as Error).message }
}
</script>

<template>
  <section>
    <h1>{{ collectionId ? definition?.locale.title : kind === 'page' ? '页面管理' : '全部内容类型' }}</h1>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="contents-alert" />
    <el-alert v-if="message" :title="message" type="success" show-icon :closable="false" class="contents-alert" />

    <el-radio-group v-if="collectionId" v-model="tab" class="cms-content-tabs">
      <el-radio-button value="items">条目</el-radio-button>
      <el-radio-button value="groups">分组</el-radio-button>
      <el-radio-button value="index">列表页面</el-radio-button>
    </el-radio-group>

    <el-card shadow="never">
      <div class="row cms-toolbar">
        <el-form class="row cms-search" inline @submit.prevent="load()">
          <el-form-item>
            <el-input v-model="query" aria-label="搜索内容" placeholder="按标题搜索" clearable style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="status" aria-label="内容状态" clearable placeholder="全部状态" style="width: 140px">
              <el-option label="全部状态" value="" />
              <el-option label="参与发布" value="published" />
              <el-option label="暂不发布" value="draft" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button native-type="submit">搜索</el-button>
          </el-form-item>
        </el-form>
        <el-button v-if="!(collectionId && tab === 'index')" type="primary" @click="openCreate">
          新建{{ labels[kind] }}
        </el-button>
      </div>

      <CmsGroupTree
        v-if="kind === 'group' && records.length"
        :nodes="tree()"
        :parent-id="null"
        @reorder="reorder"
        @edit="editGroup"
      />

      <el-table v-loading="loading" :data="records" :empty-text="`没有找到${labels[kind]}。`" style="width: 100%">
        <el-table-column label="标题" min-width="200">
          <template #default="{ row }">
            <RouterLink v-if="row.ref === 'collection' && !collectionId" :to="`/collections/${id(row)}`">
              {{ row.locale.title }}
            </RouterLink>
            <el-button v-else link type="primary" @click="edit(row)">{{ row.locale.title }}</el-button>
          </template>
        </el-table-column>
        <el-table-column label="发布设置" width="120">
          <template #default="{ row }">
            <el-tag :type="row.meta.status === 'published' ? 'success' : 'info'" size="small">
              {{ row.meta.status === 'published' ? '参与发布' : '暂不发布' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <div class="row">
              <el-button @click="edit(row)">编辑内容</el-button>
              <el-button type="danger" plain @click="deleting = row">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <el-button v-if="cursor" class="load-more" @click="load(true)">加载更多</el-button>
    </el-card>

    <el-dialog
      v-model="creating"
      :title="`新建${labels[kind]}`"
      width="520px"
      destroy-on-close
    >
      <el-form label-position="top" @submit.prevent="create">
        <el-form-item label="标题" required>
          <el-input v-model="title" />
        </el-form-item>
        <el-form-item label="网址名称" required>
          <el-input v-model="slug" placeholder="例如：company-news" />
        </el-form-item>
        <el-form-item v-if="kind === 'group'" label="上级分组">
          <el-select v-model="parentId" placeholder="没有上级分组" clearable style="width: 100%">
            <el-option label="没有上级分组" value="" />
            <el-option
              v-for="group in groups.filter(entry => levels.findIndex(level => level.levelId === entry.meta.levelId) < levels.length - 1)"
              :key="id(group)"
              :label="group.locale.title"
              :value="id(group)"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="kind === 'item' && groups.length" label="所属分组">
          <el-checkbox-group v-model="chosenGroups">
            <el-checkbox
              v-for="group in groups"
              :key="id(group)"
              :value="id(group)"
            >
              {{ group.locale.title }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <CmsFieldEditor
          v-for="field in customFields"
          :key="field.key"
          :field="field"
          :draft-id="draftId"
          :locale="contentLocale"
          :model-value="fields[field.key]"
          @update:model-value="fields[field.key] = $event"
        />
        <div class="row dialog-actions">
          <el-button type="primary" native-type="submit" :loading="busy">
            {{ busy ? '正在创建…' : '创建并编辑' }}
          </el-button>
          <el-button @click="creating = false">取消</el-button>
        </div>
      </el-form>
    </el-dialog>

    <el-dialog
      v-model="deleteVisible"
      title="删除内容"
      width="420px"
      destroy-on-close
    >
      <p>确认删除「{{ deleting?.locale.title }}」？</p>
      <template #footer>
        <el-button type="danger" :loading="busy" @click="remove">确认删除</el-button>
        <el-button @click="deleting = null">取消</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.contents-alert { margin-bottom: 16px; }
.cms-content-tabs { margin-bottom: 20px; }
.cms-toolbar { justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.cms-search { flex: 1; min-width: 0; flex-wrap: wrap; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.load-more { margin-top: 16px; }
.dialog-actions { margin-top: 8px; }
</style>

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
const error = ref(''); const message = ref(''); const busy = ref(false)
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

async function load(append = false): Promise<void> {
  const version=++generation
  const selectedCollection=collectionId.value,selectedKind=kind.value,selectedLocale=contentLocale.value,selectedDraft=getSelectedDraftId(),endpoint=base.value
  error.value = ''
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
  <section><h1>{{ collectionId ? definition?.locale.title : kind === 'page' ? '页面管理' : '内容类型' }}</h1><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
    <div v-if="collectionId" class="row cms-content-tabs"><button :class="{secondary:tab!=='items'}" @click="tab='items'">条目</button><button :class="{secondary:tab!=='groups'}" @click="tab='groups'">分组</button><button :class="{secondary:tab!=='index'}" @click="tab='index'">列表页面</button></div>
    <section class="panel"><div class="row"><form class="row" @submit.prevent="load()"><input v-model="query" aria-label="搜索内容" placeholder="按标题搜索"><select v-model="status" aria-label="内容状态"><option value="">全部状态</option><option value="published">参与发布</option><option value="draft">暂不发布</option></select><button class="secondary">搜索</button></form><button v-if="!(collectionId&&tab==='index')" @click="openCreate">新建{{ labels[kind] }}</button></div>
      <CmsGroupTree v-if="kind==='group'&&records.length" :nodes="tree()" :parent-id="null" @reorder="reorder" @edit="editGroup" />
      <table class="table"><thead><tr><th>标题</th><th>发布设置</th><th>操作</th></tr></thead><tbody><tr v-for="record in records" :key="id(record)"><td><RouterLink v-if="record.ref==='collection'&&!collectionId" :to="`/collections/${id(record)}`">{{ record.locale.title }}</RouterLink><button v-else class="quiet" @click="edit(record)">{{ record.locale.title }}</button></td><td>{{ record.meta.status==='published'?'参与发布':'暂不发布' }}</td><td><div class="row"><button class="secondary" @click="edit(record)">编辑内容</button><button class="secondary" @click="deleting=record">删除</button></div></td></tr></tbody></table><p v-if="!records.length">没有找到{{ labels[kind] }}。</p><button v-if="cursor" class="secondary" @click="load(true)">加载更多</button>
    </section>
    <dialog :open="creating" :aria-label="`新建${labels[kind]}`"><h2>新建{{ labels[kind] }}</h2><form @submit.prevent="create"><label>标题<input v-model="title" required></label><label>网址名称<input v-model="slug" required placeholder="例如：company-news"></label><label v-if="kind==='group'">上级分组<select v-model="parentId"><option value="">没有上级分组</option><option v-for="group in groups.filter(entry=>levels.findIndex(level=>level.levelId===entry.meta.levelId)<levels.length-1)" :key="id(group)" :value="id(group)">{{ group.locale.title }}</option></select></label><fieldset v-if="kind==='item'&&groups.length"><legend>所属分组</legend><label v-for="group in groups" :key="id(group)"><input v-model="chosenGroups" type="checkbox" :value="id(group)">{{ group.locale.title }}</label></fieldset><CmsFieldEditor v-for="field in customFields" :key="field.key" :field="field" :draft-id="draftId" :locale="contentLocale" :model-value="fields[field.key]" @update:model-value="fields[field.key]=$event" /><div class="row"><button :disabled="busy">{{ busy?'正在创建…':'创建并编辑' }}</button><button type="button" class="secondary" @click="creating=false">取消</button></div></form></dialog>
    <dialog :open="!!deleting" aria-label="删除内容确认"><h2>删除内容</h2><p>确认删除「{{ deleting?.locale.title }}」？</p><div class="row"><button :disabled="busy" @click="remove">确认删除</button><button class="secondary" @click="deleting=null">取消</button></div></dialog>
  </section>
</template>
<style scoped>.cms-content-tabs{margin-bottom:20px}.panel>.row{justify-content:space-between}form.row{flex-wrap:nowrap}form.row input{min-width:180px}dialog .error{margin-bottom:12px}</style>

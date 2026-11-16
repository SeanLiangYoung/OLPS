<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { fetchDraft, requireSelectedDraftId } from '../draft'
import { draftPageDetailRoute } from '../pagePaths'
import { blankPageCreateError } from '../pagesBlankValidation'
import { filterManagedPages, pageChangeLabel, type PublicationOverview, type ManagedPage } from '../siteManagement'
import PublicationPanel from '../components/PublicationPanel.vue'
import type { PageKind, SiteDraft } from '../types'

const router = useRouter()
const draft = ref<SiteDraft | null>(null)
const draftId = ref('')
const overview = ref<PublicationOverview | null>(null)
const filters = ref({ search: '', kind: 'all', locale: '', state: 'all', sort: 'newest' })
const selected = ref<string[]>([])
const currentPage = ref(1)
const pageSize = ref(20)
const error = ref('')
const busy = ref(false)
const showCreate = ref(false)
const blank = ref({ kind: 'site' as PageKind, title: '', slug: '', locale: '' })
const kindLabel: Record<string, string> = { site: '网站页面', content: '内容文章', ads: '广告承接页' }
const filtered = computed(() => filterManagedPages(overview.value?.pages || [], filters.value))
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
const visible = computed(() => filtered.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))
const allVisibleSelected = computed(() => visible.value.some(page => page.changed) && visible.value.filter(page => page.changed).every(page => selected.value.includes(page.pageId)))
watch([filters, pageSize], () => { currentPage.value = 1 }, { deep: true })

async function reload() {
  error.value = ''
  try {
    draftId.value = requireSelectedDraftId()
    const [loadedDraft, state] = await Promise.all([
      fetchDraft(draftId.value),
      api<PublicationOverview>('GET', `/api/drafts/${draftId.value}/publication`),
    ])
    draft.value = loadedDraft
    overview.value = state
    selected.value = selected.value.filter(id => state.pages.some(page => page.pageId === id && page.changed))
    currentPage.value = Math.min(currentPage.value, totalPages.value)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
onMounted(reload)

function selectVisible() {
  const ids = visible.value.filter(page => page.changed).map(page => page.pageId)
  if (allVisibleSelected.value) selected.value = selected.value.filter(id => !ids.includes(id))
  else selected.value = [...new Set([...selected.value, ...ids])]
}
function toggle(page: ManagedPage) {
  selected.value = selected.value.includes(page.pageId) ? selected.value.filter(id => id !== page.pageId) : [...selected.value, page.pageId]
}
async function restorePage(page: ManagedPage) {
  busy.value = true
  error.value = ''
  try {
    await api('POST', `/api/drafts/${draftId.value}/publication/pages/${page.pageId}/restore`)
    await reload()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
async function createBlank() {
  const title = blank.value.title.trim()
  const slug = blank.value.slug.trim() || `page-${Date.now().toString(36)}`
  const invalid = blankPageCreateError(title, slug)
  if (invalid) { error.value = invalid; return }
  busy.value = true
  error.value = ''
  try {
    const data = await api<{ page: { pageId: string } }>('POST', `/api/drafts/${draftId.value}/pages`, {
      kind: blank.value.kind, title, slug, locale: blank.value.locale || draft.value?.settings.defaultLocale,
    })
    await router.push(draftPageDetailRoute(draftId.value, data.page.pageId))
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="page-heading"><div><h1>页面管理</h1><p class="muted">管理网站内容，选择准备好的页面发布。</p></div><div class="row"><RouterLink class="btn secondary" to="/generate">AI 生成页面</RouterLink><button type="button" @click="showCreate = !showCreate">新增页面</button></div></div>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <section v-if="showCreate" class="panel" aria-label="新增页面">
    <h2>新增页面</h2>
    <div class="grid-2">
      <label>页面用途<select v-model="blank.kind"><option value="site">网站页面</option><option value="content">内容文章</option><option value="ads">广告承接页</option></select></label>
      <label>标题<input v-model="blank.title" placeholder="例如：关于我们" /></label>
      <label>页面地址<input v-model="blank.slug" placeholder="自动生成，也可以自行填写" /></label>
      <label>语言<select v-model="blank.locale"><option value="">使用网站默认语言</option><option v-for="locale in draft?.settings.locales || []" :key="locale" :value="locale">{{ locale }}</option></select></label>
    </div>
    <div class="row"><button type="button" :disabled="busy" @click="createBlank">创建并编辑</button><button type="button" class="ghost" @click="showCreate = false">取消</button></div>
  </section>
  <section class="panel">
    <label>页面排序<select v-model="filters.sort" aria-label="页面排序"><option value="newest">最近编辑优先</option><option value="oldest">较早编辑优先</option><option value="title">按照标题排列</option></select></label>
    <div class="tabs" aria-label="页面分类"><button v-for="kind in ['all', 'site', 'content', 'ads']" :key="kind" type="button" :class="{ active: filters.kind === kind }" @click="filters.kind = kind">{{ kind === 'all' ? '全部页面' : kindLabel[kind] }} <span>{{ overview?.pages.filter(page => kind === 'all' || page.kind === kind).length || 0 }}</span></button></div>
    <div class="page-filters"><label>搜索页面<input v-model="filters.search" type="search" placeholder="搜索标题或页面地址" /></label><label>语言<select v-model="filters.locale"><option value="">全部语言</option><option v-for="locale in draft?.settings.locales || []" :key="locale" :value="locale">{{ locale }}</option></select></label><label>页面状态<select v-model="filters.state"><option value="all">全部状态</option><option value="changed">有未发布更改</option><option value="published">线上可访问</option><option value="unpublished">线上未展示</option></select></label><button type="button" class="ghost" @click="reload">刷新</button></div>
    <div class="row selection-bar"><span>已选择 {{ selected.length }} 个页面</span><PublicationPanel :draft-id="draftId" :page-ids="selected" @published="reload" /><button v-if="selected.length" type="button" class="ghost" @click="selected = []">取消选择</button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th><input type="checkbox" aria-label="选择当前页" :checked="allVisibleSelected" @change="selectVisible" /></th><th>页面标题</th><th>类型与语言</th><th>线上状态</th><th>编辑状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody><tr v-for="page in visible" :key="page.pageId"><td><input type="checkbox" :aria-label="`选择 ${page.title}`" :checked="selected.includes(page.pageId)" :disabled="!page.changed" @change="toggle(page)" /></td><td><RouterLink v-if="page.operation !== 'delete'" :to="draftPageDetailRoute(draftId, page.pageId)"><strong>{{ page.title }}</strong></RouterLink><strong v-else>{{ page.title }}</strong><div class="muted">/{{ page.slug }}/</div></td><td>{{ kindLabel[page.kind] || page.kind }}<div class="muted">{{ page.locale }}</div></td><td><span class="badge" :class="page.onlineStatus">{{ page.onlineStatus === 'published' ? '线上可访问' : '线上未展示' }}</span></td><td><span :class="{ 'change-indicator': page.changed }">{{ pageChangeLabel(page) }}</span></td><td class="muted">{{ page.updatedAt ? new Date(page.updatedAt).toLocaleString('zh-CN') : '—' }}</td><td><RouterLink v-if="page.operation !== 'delete'" :to="draftPageDetailRoute(draftId, page.pageId)">编辑页面</RouterLink><button v-else type="button" class="ghost" :disabled="busy" @click="restorePage(page)">取消删除</button></td></tr></tbody></table></div>
    <p v-if="!filtered.length" class="empty-state">{{ overview?.pages.length ? '没有符合条件的页面。' : '还没有页面，可以新增页面或使用 AI 生成。' }}</p>
    <div class="row pagination"><span class="muted">共 {{ filtered.length }} 个页面</span><label>每页<select v-model.number="pageSize"><option :value="20">20</option><option :value="50">50</option><option :value="100">100</option></select></label><button type="button" class="ghost" :disabled="currentPage <= 1" @click="currentPage--">上一页</button><span>{{ currentPage }} / {{ totalPages }}</span><button type="button" class="ghost" :disabled="currentPage >= totalPages" @click="currentPage++">下一页</button></div>
  </section>
</template>

<style scoped>
.page-filters { display: grid; grid-template-columns: minmax(180px, 1fr) 150px 180px auto; gap: .8rem; align-items: end; }
.page-filters label { margin-bottom: 0; }
.selection-bar { padding: 1rem 0; margin-top: .8rem; border-top: 1px solid var(--line); }
.table input { width: auto; }
.change-indicator { color: #a45c00; font-size: .9rem; }
.pagination { justify-content: flex-end; padding-top: 1rem; }
.pagination label { margin: 0; display: flex; align-items: center; gap: .5rem; }
.pagination select { width: auto; }
@media (max-width: 900px) { .page-filters { grid-template-columns: 1fr 1fr; } }
</style>

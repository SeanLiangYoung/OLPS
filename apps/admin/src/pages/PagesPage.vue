<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { fetchDraft, requireSelectedDraftId } from '../draft'
import { draftPageDetailRoute } from '../pagePaths'
import { blankPageCreateError } from '../pagesBlankValidation'
import type { PageKind, PageRecord, SiteDraft } from '../types'

const router = useRouter()
const draft = ref<SiteDraft | null>(null)
const draftId = ref('')
const pages = ref<PageRecord[]>([])
const kindTab = ref<PageKind | 'all'>('all')
const onlyPublished = ref(false)
const error = ref('')
const busy = ref(false)

const blank = ref({
  kind: 'site' as PageKind,
  title: '未命名页面',
  slug: `page-${Date.now().toString(36)}`,
})

const kindLabel: Record<PageKind, string> = {
  site: '通用站页',
  content: '内容页',
  ads: '广告承接页',
}

const filtered = computed(() =>
  pages.value.filter((p) => {
    if (kindTab.value !== 'all' && p.kind !== kindTab.value) return false
    if (onlyPublished.value && p.status !== 'published') return false
    return true
  }),
)

const counts = computed(() => {
  const base = { site: 0, content: 0, ads: 0, sitePub: 0, contentPub: 0, adsPub: 0 }
  for (const p of pages.value) {
    base[p.kind] += 1
    if (p.status === 'published') {
      if (p.kind === 'site') base.sitePub += 1
      if (p.kind === 'content') base.contentPub += 1
      if (p.kind === 'ads') base.adsPub += 1
    }
  }
  return base
})

async function loadPages() {
  if (!draftId.value) return
  const data = await api<{ pages: PageRecord[] }>(
    'GET',
    `/api/drafts/${draftId.value}/pages`,
  )
  pages.value = data.pages ?? []
}

async function init() {
  error.value = ''
  try {
    const id = requireSelectedDraftId()
    draftId.value = id
    draft.value = await fetchDraft(id)
    await loadPages()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(init)

async function createBlank() {
  error.value = ''
  const title = blank.value.title.trim()
  const slug = blank.value.slug.trim()
  const validationError = blankPageCreateError(blank.value.title, blank.value.slug)
  if (validationError) {
    error.value = validationError
    return
  }
  busy.value = true
  try {
    const data = await api<{ page: PageRecord }>(
      'POST',
      `/api/drafts/${draftId.value}/pages`,
      {
        kind: blank.value.kind,
        title,
        slug,
      },
    )
    blank.value.slug = `page-${Date.now().toString(36)}`
    await loadPages()
    if (data.page?.pageId) {
      await router.push(draftPageDetailRoute(draftId.value, data.page.pageId))
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

</script>

<template>
  <section class="panel">
    <div class="row" style="justify-content: space-between;">
      <h1 style="margin: 0;">页面</h1>
      <RouterLink class="btn" to="/generate">去生成</RouterLink>
    </div>
    <p v-if="draft" class="muted">当前草稿：{{ draft.name }}</p>
    <div class="tabs">
      <button type="button" :class="{ active: kindTab === 'all' }" @click="kindTab = 'all'">全部</button>
      <button type="button" :class="{ active: kindTab === 'site' }" @click="kindTab = 'site'">
        通用站页 {{ counts.site }} · 已发布 {{ counts.sitePub }}
      </button>
      <button type="button" :class="{ active: kindTab === 'content' }" @click="kindTab = 'content'">
        内容页 {{ counts.content }} · 已发布 {{ counts.contentPub }}
      </button>
      <button type="button" :class="{ active: kindTab === 'ads' }" @click="kindTab = 'ads'">
        广告承接页 {{ counts.ads }} · 已发布 {{ counts.adsPub }}
      </button>
    </div>
    <p class="muted">
      页面「已发布」指标仅表示 sandbox 内标记；访客可见的线上版本请在
      <RouterLink to="/publish">发布与同步</RouterLink> 执行 Push。
    </p>
    <label class="row">
      <input v-model="onlyPublished" type="checkbox" style="width:auto" />
      仅 sandbox 内标记为已发布
    </label>
    <p v-if="error" class="error">{{ error }}</p>
    <table class="table">
      <thead>
        <tr>
          <th>类型</th>
          <th>标题</th>
          <th>slug</th>
          <th>状态</th>
          <th>更新时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in filtered" :key="p.pageId">
          <td>{{ kindLabel[p.kind] }}</td>
          <td>{{ p.title }}</td>
          <td>{{ p.slug }}</td>
          <td>
            <span class="badge" :class="p.status">{{ p.status === 'published' ? '已发布' : '草稿' }}</span>
          </td>
          <td class="muted">{{ p.updatedAt }}</td>
          <td class="row">
            <RouterLink :to="draftPageDetailRoute(draftId, p.pageId)">详情</RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!filtered.length" class="muted">暂无页面。</p>
  </section>

  <section class="panel">
    <h2>创建空白页</h2>
    <div class="grid-2">
      <label>
        类型
        <select v-model="blank.kind">
          <option value="site">通用站页</option>
          <option value="content">内容页</option>
          <option value="ads">广告承接页</option>
        </select>
      </label>
      <label>标题 <input v-model="blank.title" /></label>
      <label>slug <input v-model="blank.slug" /></label>
    </div>
    <button type="button" :disabled="busy" @click="createBlank">创建并打开</button>
  </section>
</template>

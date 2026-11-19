<script setup lang="ts">
import { computed, onBeforeUnmount, onUnmounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import { api } from '../api'
import { requireSelectedDraftId } from '../draft'
import { pageDraftMismatchMessage } from '../pageDraftGuard'
import { applySavedPageMetadata, pageEditSnapshot, protectPageUnload, PageEditSession } from '../pageEditSession'
import { draftPageDetailApiPath, draftPagePreviewApiPath } from '../pagePaths'
import { selectedDraftIdState } from '../workspaceSession'
import type { PageRecord } from '../types'

type PreviewWidth = 'mobile' | 'tablet' | 'desktop'

const route = useRoute()
const page = ref<PageRecord | null>(null)
const error = ref('')
const message = ref('')
const previewUrl = ref('')
const previewWidth = ref<PreviewWidth>('desktop')
const editSession = reactive(new PageEditSession())
const saveStatus = computed(() => page.value ? editSession.saveStatus(page.value) : '')
const needsLeaveWarning = computed(() => editSession.needsLeaveWarning(page.value))

function confirmLeave(): boolean {
  return !needsLeaveWarning.value || window.confirm('修改尚未保存完成，离开可能丢失输入。确定离开？')
}

onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate((to, from) => {
  if (to.params.draftId === from.params.draftId && to.params.pageId === from.params.pageId) return true
  return confirmLeave()
})

function onBeforeUnload(event: BeforeUnloadEvent): void {
  protectPageUnload(event, needsLeaveWarning.value)
}

watch(needsLeaveWarning, (shouldWarn) => {
  if (shouldWarn) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
}, { flush: 'sync' })

onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload))

const widthPx = computed(() => {
  if (previewWidth.value === 'mobile') return 390
  if (previewWidth.value === 'tablet') return 768
  return 1100
})

function routeDraftId(): string {
  return String(route.params.draftId ?? '')
}

function routePageId(): string {
  return String(route.params.pageId ?? '')
}

async function load() {
  const generation = editSession.reset()
  page.value = null
  previewUrl.value = ''
  error.value = ''
  message.value = ''
  try {
    const selectedDraftId = requireSelectedDraftId()
    const draftId = routeDraftId()
    const pageId = routePageId()
    const mismatch = pageDraftMismatchMessage(selectedDraftId, draftId)
    if (mismatch) {
      error.value = mismatch
      return
    }
    const data = await api<{ page: PageRecord }>(
      'GET',
      draftPageDetailApiPath(draftId, pageId),
    )
    if (!editSession.isCurrent(generation)) return
    editSession.acceptSaved(pageEditSnapshot(data.page))
    page.value = data.page
  } catch (e) {
    if (editSession.isCurrent(generation)) error.value = e instanceof Error ? e.message : String(e)
  }
}

watch(
  () => [route.params.draftId, route.params.pageId, selectedDraftIdState.value],
  load,
  { immediate: true, flush: 'sync' },
)

onBeforeUnmount(() => {
  editSession.reset()
})

async function savePage(current: PageRecord, draftId: string, generation: number) {
  const sent = pageEditSnapshot(current)
  const data = await api<{ page: PageRecord }>(
    'PATCH',
    draftPageDetailApiPath(draftId, current.pageId),
    { title: current.title, seo: current.seo, body: current.body },
  )
  if (!editSession.isCurrent(generation)) return
  applySavedPageMetadata(current, data.page)
  editSession.acceptSaved(sent)
}

async function runOperation(action: (current: PageRecord, draftId: string, generation: number) => Promise<void>) {
  if (!page.value) return
  const generation = editSession.begin()
  if (generation === null) return
  const current = page.value
  const draftId = routeDraftId()
  error.value = ''
  message.value = ''
  try {
    await action(current, draftId, generation)
  } catch (e) {
    if (editSession.isCurrent(generation)) {
      editSession.saveFailed = !editSession.savedDuringOperation
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    editSession.finish(generation)
  }
}

async function saveMetaAndBody() {
  await runOperation(async (current, draftId, generation) => {
    await savePage(current, draftId, generation)
  })
}

async function preview() {
  await runOperation(async (current, draftId, generation) => {
    previewUrl.value = ''
    await savePage(current, draftId, generation)
    if (!editSession.isCurrent(generation)) return
    const data = await api<{ previewUrl: string }>(
      'POST',
      draftPagePreviewApiPath(draftId, current.pageId),
    )
    if (!editSession.isCurrent(generation)) return
    previewUrl.value = data.previewUrl
    message.value = '预览已更新'
  })
}
</script>

<template>
  <section v-if="error && !page" class="panel">
    <p><RouterLink to="/pages">← 返回列表</RouterLink></p>
    <p class="error" role="alert">{{ error }}</p>
    <RouterLink class="btn" to="/workspace">切换工作区</RouterLink>
  </section>

  <section v-if="page" class="panel">
    <p><RouterLink to="/pages">← 返回列表</RouterLink></p>
    <h1>{{ page.title }}</h1>
    <p class="muted">
      {{ page.kind }} ·
      <span class="badge" :class="page.status">{{ page.status === 'published' ? '已发布' : '草稿' }}</span>
      · {{ page.slug }}
    </p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>
    <p role="status" aria-live="polite" data-page-save-status>{{ saveStatus }}</p>
    <button v-if="editSession.saveFailed" type="button" @click="saveMetaAndBody">重试保存全部修改</button>

    <h2>SEO</h2>
    <label>标题 <input v-model="page.title" /></label>
    <label>SEO title <input v-model="page.seo.title" /></label>
    <label>SEO description <textarea v-model="page.seo.description" rows="2" /></label>

    <h2>HTML 正文</h2>
    <label>
      body.html
      <textarea v-model="page.body.html" rows="14" style="font-family: ui-monospace, monospace;" />
    </label>

    <div class="row">
      <button type="button" :disabled="editSession.pending" @click="saveMetaAndBody">保存</button>
      <button type="button" class="secondary" :disabled="editSession.pending" @click="preview">保存并预览</button>
      <RouterLink class="btn" to="/publish">前往 Push 发布</RouterLink>
    </div>
    <p class="muted">线上发布通过当前草稿整体 Push 完成，不提供单页发布接口。</p>
  </section>

  <section v-if="page" class="panel">
    <h2>预览</h2>
    <div class="tabs">
      <button type="button" :class="{ active: previewWidth === 'mobile' }" @click="previewWidth = 'mobile'">
        手机
      </button>
      <button type="button" :class="{ active: previewWidth === 'tablet' }" @click="previewWidth = 'tablet'">
        平板
      </button>
      <button type="button" :class="{ active: previewWidth === 'desktop' }" @click="previewWidth = 'desktop'">
        桌面
      </button>
      <button type="button" class="secondary" :disabled="editSession.pending" @click="preview">保存并预览</button>
    </div>
    <p v-if="previewUrl" class="muted">
      <a :href="previewUrl" target="_blank" rel="noopener">{{ previewUrl }}</a>
    </p>
    <p v-else class="muted">点击「保存并预览」后显示 iframe。</p>
    <div v-if="previewUrl" class="preview-frame" :style="{ width: widthPx + 'px', maxWidth: '100%' }">
      <iframe
        :src="previewUrl"
        title="page-preview"
        sandbox="allow-scripts allow-forms"
      />
    </div>
  </section>

  <section v-if="!page && !error" class="panel">
    <p class="muted">加载中…</p>
  </section>
  <section v-if="!page && error" class="panel">
    <p class="error">{{ error }}</p>
  </section>
</template>

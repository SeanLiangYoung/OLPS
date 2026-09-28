<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, pollJob } from '../api'
import { fetchDraft, requireSelectedDraftId } from '../draft'
import { draftPageDetailRoute } from '../pagePaths'
import type { JobRecord, KnowledgeBase, KnowledgeDocument, PageKind, SiteDraft } from '../types'

const router = useRouter()
const draft = ref<SiteDraft | null>(null)
const draftId = ref('')
const knowledgeBases = ref<KnowledgeBase[]>([])
const knowledgeBaseId = ref('')
const documents = ref<KnowledgeDocument[]>([])
const error = ref('')
const message = ref('')
const busy = ref(false)
const job = ref<JobRecord | null>(null)
const resultPageId = ref('')

const form = ref({
  kind: 'site' as PageKind,
  title: '',
  slug: '',
  brief: '',
  keywords: 'buy steel, rent steel',
})

const newKbName = ref('')
const newDoc = ref({ title: '', content: '' })

async function loadKnowledgeBases() {
  const data = await api<{ knowledgeBases: KnowledgeBase[] }>('GET', '/api/knowledge-bases')
  knowledgeBases.value = data.knowledgeBases ?? []
  if (!knowledgeBaseId.value && knowledgeBases.value.length) {
    knowledgeBaseId.value = knowledgeBases.value[0]!.kbId
  }
}

async function loadDocuments() {
  if (!knowledgeBaseId.value) {
    documents.value = []
    return
  }
  const data = await api<{ documents: KnowledgeDocument[] }>(
    'GET',
    `/api/knowledge-bases/${knowledgeBaseId.value}/documents`,
  )
  documents.value = data.documents ?? []
}

onMounted(async () => {
  try {
    const id = requireSelectedDraftId()
    draftId.value = id
    draft.value = await fetchDraft(id)
    await loadKnowledgeBases()
    await loadDocuments()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

async function onKbChange() {
  error.value = ''
  try {
    await loadDocuments()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function createKb() {
  error.value = ''
  if (!newKbName.value.trim()) {
    error.value = '请填写知识库名称'
    return
  }
  try {
    const data = await api<{ knowledgeBase: KnowledgeBase }>('POST', '/api/knowledge-bases', {
      name: newKbName.value.trim(),
    })
    newKbName.value = ''
    await loadKnowledgeBases()
    knowledgeBaseId.value = data.knowledgeBase.kbId
    await loadDocuments()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function addDocument() {
  error.value = ''
  if (!knowledgeBaseId.value) {
    error.value = '请先选择知识库'
    return
  }
  if (!newDoc.value.title.trim() || !newDoc.value.content.trim()) {
    error.value = '文档标题与内容均必填'
    return
  }
  try {
    await api('POST', `/api/knowledge-bases/${knowledgeBaseId.value}/documents`, {
      title: newDoc.value.title.trim(),
      content: newDoc.value.content.trim(),
    })
    newDoc.value = { title: '', content: '' }
    await loadDocuments()
    message.value = '文档已添加'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

const canSubmit = computed(
  () =>
    Boolean(
      draftId.value &&
        knowledgeBaseId.value &&
        form.value.title.trim() &&
        form.value.slug.trim(),
    ),
)

let cancelled = false
onUnmounted(() => {
  cancelled = true
})

async function submit() {
  error.value = ''
  message.value = ''
  resultPageId.value = ''
  job.value = null
  if (!knowledgeBaseId.value) {
    error.value = '生成必须选择知识库'
    return
  }
  if (!form.value.title.trim() || !form.value.slug.trim()) {
    error.value = '标题与 slug 必填'
    return
  }
  busy.value = true
  try {
    const payload: Record<string, unknown> = {
      draftId: draftId.value,
      knowledgeBaseId: knowledgeBaseId.value,
      kind: form.value.kind,
      title: form.value.title.trim(),
      slug: form.value.slug.trim(),
      brief: form.value.brief,
    }
    if (form.value.kind === 'ads') {
      payload.keywords = form.value.keywords
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    const created = await api<{ job?: JobRecord; page?: { pageId: string } }>(
      'POST',
      '/api/jobs/generate_page',
      payload,
    )
    if (created.job?.jobId) {
      job.value = created.job
      message.value = `任务已提交：${created.job.jobId}`
      const finished = await pollJob<JobRecord>(created.job.jobId)
      if (cancelled) return
      job.value = finished
      if (finished.status === 'failed') {
        error.value = finished.error || '生成失败'
        return
      }
      const pageId =
        (finished.result?.pageId as string | undefined) ||
        (finished.result?.page as { pageId?: string } | undefined)?.pageId ||
        ''
      resultPageId.value = pageId
      message.value = '生成完成'
    } else if (created.page?.pageId) {
      resultPageId.value = created.page.pageId
      message.value = '生成完成'
    } else {
      throw new Error('接口未返回 job 或 page')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function openPage() {
  if (resultPageId.value && draftId.value) {
    router.push(draftPageDetailRoute(draftId.value, resultPageId.value))
  }
}
</script>

<template>
  <section class="panel">
    <h1>生成页面</h1>
    <p class="muted">固定流程：当前草稿 → 选择知识库 → 填写参数 → 提交任务。</p>
    <p v-if="draft">草稿：{{ draft.name }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <label>
      知识库（必选）
      <select v-model="knowledgeBaseId" @change="onKbChange">
        <option disabled value="">请选择</option>
        <option v-for="kb in knowledgeBases" :key="kb.kbId" :value="kb.kbId">
          {{ kb.name }}
        </option>
      </select>
    </label>

    <div class="row" style="margin-bottom: 1rem;">
      <input v-model="newKbName" placeholder="新建知识库名称" style="max-width: 240px;" />
      <button type="button" class="secondary" @click="createKb">新建知识库</button>
    </div>

    <div v-if="knowledgeBaseId" class="panel" style="background: #fff; margin: 0 0 1rem;">
      <h3 style="margin-top: 0;">知识库文档（{{ documents.length }}）</h3>
      <ul v-if="documents.length">
        <li v-for="d in documents" :key="d.docId">{{ d.title }}</li>
      </ul>
      <p v-else class="muted">暂无文档，请先添加，否则生成可能失败。</p>
      <div class="grid">
        <label>文档标题 <input v-model="newDoc.title" /></label>
        <label>文档内容 <textarea v-model="newDoc.content" rows="4" /></label>
        <button type="button" class="secondary" @click="addDocument">添加文档</button>
      </div>
    </div>

    <div class="grid">
      <label>
        类型
        <select v-model="form.kind">
          <option value="site">通用站页</option>
          <option value="content">内容页</option>
          <option value="ads">广告承接页</option>
        </select>
      </label>
      <label>标题 <input v-model="form.title" /></label>
      <label>slug <input v-model="form.slug" /></label>
      <label>brief <textarea v-model="form.brief" rows="3" /></label>
      <label v-if="form.kind === 'ads'">
        关键词（逗号分隔）
        <input v-model="form.keywords" />
      </label>
      <button type="button" :disabled="busy || !canSubmit" @click="submit">
        {{ busy ? '生成中…' : '提交生成任务' }}
      </button>
    </div>

    <div v-if="job" style="margin-top: 1rem;">
      <p>任务状态：<span class="badge">{{ job.status }}</span> · {{ job.jobId }}</p>
      <p v-if="job.error" class="error">{{ job.error }}</p>
    </div>
    <div v-if="resultPageId" class="row" style="margin-top: 0.75rem;">
      <button type="button" @click="openPage">打开页面详情</button>
      <RouterLink v-if="draftId" :to="draftPageDetailRoute(draftId, resultPageId)">{{
        resultPageId
      }}</RouterLink>
    </div>
  </section>
</template>

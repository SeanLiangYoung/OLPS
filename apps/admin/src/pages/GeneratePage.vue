<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { fetchDraft, requireSelectedDraftId } from '../draft'
import { draftPageDetailRoute } from '../pagePaths'
import type { JobRecord, KnowledgeBase, KnowledgeDocument, PageKind, PageRecord, SiteDraft } from '../types'

const router = useRouter()
const draft = ref<SiteDraft | null>(null)
const draftId = ref('')
const knowledgeBases = ref<KnowledgeBase[]>([])
const knowledgeBaseId = ref('')
const documents = ref<KnowledgeDocument[]>([])
const error = ref('')
const message = ref('')
const busy = ref(false)

const form = ref({
  kind: 'site' as PageKind,
  title: '',
  slug: '',
  brief: '',
})

const newKbName = ref('')
const newDoc = ref({ title: '', content: '' })

async function loadKnowledgeBases() {
  const data = await api<{ knowledgeBases: KnowledgeBase[] }>('GET', '/api/knowledge-bases')
  knowledgeBases.value = data.knowledgeBases ?? []
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
        form.value.title.trim() &&
        form.value.slug.trim() &&
        form.value.brief.trim(),
    ),
)

let cancelled = false
onUnmounted(() => {
  cancelled = true
})

async function submit() {
  error.value = ''
  message.value = ''
  if (!canSubmit.value) {
    error.value = '标题、slug 与页面需求必填'
    return
  }
  busy.value = true
  try {
    const payload: Record<string, unknown> = {
      draftId: draftId.value,
      kind: form.value.kind,
      title: form.value.title.trim(),
      slug: form.value.slug.trim(),
      brief: form.value.brief.trim(),
    }
    if (knowledgeBaseId.value) {
      payload.knowledgeBaseId = knowledgeBaseId.value
    }
    const created = await api<{ job: JobRecord; page: PageRecord }>(
      'POST',
      '/api/jobs/generate_page',
      payload,
    )
    if (cancelled) return
    await router.push(draftPageDetailRoute(draftId.value, created.page.pageId))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="panel">
    <h1>用 AI 生成页面</h1>
    <p class="muted">描述页面需求，AI 生成完整的 SEO 与 HTML 并写入当前草稿；生成后进入页面详情预览、修改，再 Push 发布。</p>
    <p v-if="draft">草稿：{{ draft.name }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <div class="grid">
      <label>
        类型
        <select v-model="form.kind">
          <option value="site">通用站页</option>
          <option value="content">内容页</option>
        </select>
      </label>
      <label>标题 <input v-model="form.title" /></label>
      <label>slug <input v-model="form.slug" /></label>
      <label>
        页面需求
        <textarea
          v-model="form.brief"
          rows="5"
          placeholder="例如：公司的联系页面，介绍联系方式和营业时间，并放一个询盘表单"
        />
      </label>
    </div>

    <label>
      参考知识库（可选，生成内容以知识库资料为准）
      <select v-model="knowledgeBaseId" @change="onKbChange">
        <option value="">不使用知识库</option>
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
      <p v-else class="muted">暂无文档。</p>
      <div class="grid">
        <label>文档标题 <input v-model="newDoc.title" /></label>
        <label>文档内容 <textarea v-model="newDoc.content" rows="4" /></label>
        <button type="button" class="secondary" @click="addDocument">添加文档</button>
      </div>
    </div>

    <button type="button" :disabled="busy || !canSubmit" @click="submit">
      {{ busy ? 'AI 生成中…' : 'AI 生成页面' }}
    </button>
  </section>
</template>

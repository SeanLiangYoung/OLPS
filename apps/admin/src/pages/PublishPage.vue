<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import ConflictDecision from '../components/ConflictDecision.vue'
import {
  continueDraftSync,
  fetchDraft,
  listPublishedSites,
  pullDraft,
  pushDraft,
  requireSelectedDraftId,
} from '../draft'
import {
  conflictDecisionSummary,
  draftStatusLabel,
  formatCommitRef,
  pushSuccessMessage,
  showConflictDecision,
  syncActionDisabledReason,
  syncProcessingLabel,
} from '../draftDisplay'
import type { PageRecord, PublishedSite, SiteDraft } from '../types'

const draft = ref<SiteDraft | null>(null)
const publishedSite = ref<PublishedSite | null>(null)
const pages = ref<PageRecord[]>([])
const error = ref('')
const message = ref('')
const busy = ref(false)

const pullDisabledReason = computed(() =>
  draft.value ? syncActionDisabledReason(draft.value, 'pull') : '草稿未加载',
)

const pushDisabledReason = computed(() =>
  draft.value ? syncActionDisabledReason(draft.value, 'push') : '草稿未加载',
)

const needsDecision = computed(() =>
  draft.value ? showConflictDecision(draft.value) : false,
)

async function reloadDraft() {
  const draftId = requireSelectedDraftId()
  draft.value = await fetchDraft(draftId)
  if (draft.value.siteId) {
    const sites = await listPublishedSites()
    publishedSite.value = sites.find((s) => s.siteId === draft.value!.siteId!) ?? null
    const data = await api<{ pages: PageRecord[] }>(
      'GET',
      `/api/sites/${draft.value.siteId}/pages?status=published`,
    )
    pages.value = data.pages ?? []
  } else {
    publishedSite.value = null
    pages.value = []
  }
}

onMounted(async () => {
  try {
    await reloadDraft()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

async function runPull() {
  if (!draft.value || pullDisabledReason.value) return
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    draft.value = await pullDraft(draft.value.draftId)
    if (draft.value.status === 'active') {
      message.value = 'Pull 已完成，sandbox 已更新'
    } else if (showConflictDecision(draft.value)) {
      message.value = 'Pull 暂停，等待你的决定'
    } else {
      message.value = 'Pull 请求已完成，请查看下方状态'
    }
    await reloadDraft()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    await reloadDraft()
  } finally {
    busy.value = false
  }
}

async function runPush() {
  if (!draft.value || pushDisabledReason.value) return
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    const result = await pushDraft(draft.value.draftId)
    draft.value = result.draft
    if (result.site) publishedSite.value = result.site
    const okMsg = pushSuccessMessage(
      result.draft,
      result.site?.publicUrl ?? publishedSite.value?.publicUrl,
    )
    if (okMsg) {
      message.value = okMsg
    } else if (showConflictDecision(result.draft)) {
      message.value = 'Push 暂停，等待你的决定'
    } else if (result.draft.status === 'error') {
      error.value = result.draft.lastError || 'Push 失败'
    } else {
      message.value = 'Push 请求已完成，请查看下方状态'
    }
    await reloadDraft()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    await reloadDraft()
  } finally {
    busy.value = false
  }
}

async function onContinueDecision(payload: { userMessage: string }) {
  if (!draft.value) return
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    draft.value = await continueDraftSync(draft.value.draftId, payload.userMessage)
    if (showConflictDecision(draft.value)) {
      message.value = '已提交决定，仍等待进一步处理或补充说明'
    } else if (draft.value.status === 'error') {
      error.value = draft.value.lastError || '继续同步失败'
    } else {
      message.value = '已提交决定，同步流程已继续'
    }
    await reloadDraft()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    await reloadDraft()
  } finally {
    busy.value = false
  }
}

function publicUrls(page: PageRecord): string[] {
  if (page.publicUrls?.length) return page.publicUrls
  const base = publishedSite.value?.publicUrl
  if (!base) return []
  return [`${base.replace(/\/$/, '')}/${page.slug}/`]
}
</script>

<template>
  <section class="panel">
    <h1>发布与 Git 同步</h1>
    <p class="muted">
      线上发布仅通过草稿整体 Push 完成；Pull 将远端已发布版本合并进 sandbox。
    </p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <div v-if="draft" class="panel" style="background: #fff;">
      <h2 style="margin-top: 0;">当前草稿</h2>
      <p>
        {{ draft.name }}
        <span class="badge" :class="draft.status">{{ draftStatusLabel(draft.status) }}</span>
        <span v-if="draft.syncStatus" class="badge syncing">
          {{ syncProcessingLabel(draft.syncStatus) }}
        </span>
      </p>
      <p class="muted">
        sandbox {{ draft.sandboxId.slice(0, 8) }} · base
        {{ formatCommitRef(draft.baseCommitId) }} · head
        {{ formatCommitRef(draft.headCommitId) }}
        <span v-if="draft.pendingOperation"> · 进行中 {{ draft.pendingOperation }}</span>
      </p>
      <p v-if="draft.validationLog" class="muted" style="white-space: pre-wrap;">
        {{ draft.validationLog }}
      </p>
      <p v-if="draft.lastError" class="error">{{ draft.lastError }}</p>

      <ConflictDecision
        v-if="needsDecision"
        :summary="conflictDecisionSummary(draft)"
        :disabled="busy"
        @submit="onContinueDecision"
      />

      <div class="row" style="margin-top: 0.75rem;">
        <button
          type="button"
          class="secondary"
          :disabled="busy || Boolean(pullDisabledReason)"
          :title="pullDisabledReason"
          @click="runPull"
        >
          {{ busy ? '处理中…' : 'Pull 远端版本' }}
        </button>
        <button
          type="button"
          :disabled="busy || Boolean(pushDisabledReason)"
          :title="pushDisabledReason"
          @click="runPush"
        >
          {{ busy ? '处理中…' : 'Push 并发布' }}
        </button>
      </div>
      <p v-if="pullDisabledReason" class="muted">{{ pullDisabledReason }}</p>
      <p v-if="pushDisabledReason" class="muted">{{ pushDisabledReason }}</p>
    </div>

    <div v-if="publishedSite" class="panel" style="background: #fff;">
      <h2 style="margin-top: 0;">线上网站</h2>
      <p>
        {{ publishedSite.name }}
        <span class="muted">版本 {{ formatCommitRef(publishedSite.publishedCommitId) }}</span>
      </p>
      <p v-if="publishedSite.publicUrl">
        <a :href="publishedSite.publicUrl" target="_blank" rel="noopener">{{
          publishedSite.publicUrl
        }}</a>
      </p>
    </div>
  </section>

  <section v-if="publishedSite" class="panel">
    <h2>当前已发布页面</h2>
    <table class="table">
      <thead>
        <tr>
          <th>类型</th>
          <th>标题</th>
          <th>slug</th>
          <th>公开 URL</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in pages" :key="p.pageId">
          <td>{{ p.kind }}</td>
          <td>{{ p.title }}</td>
          <td>{{ p.slug }}</td>
          <td>
            <div v-for="u in publicUrls(p)" :key="u">
              <a :href="u" target="_blank" rel="noopener">{{ u }}</a>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!pages.length" class="muted">关联网站尚无已发布页面。</p>
  </section>

  <section v-else-if="draft" class="panel">
    <p class="muted">此草稿尚未关联已发布网站；首次 Push 成功后将创建网站记录。</p>
  </section>
</template>

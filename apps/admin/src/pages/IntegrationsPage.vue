<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { fetchDraft, listPublishedSites, requireSelectedDraftId } from '../draft'
import {
  businessViewReady,
  integrationsPath,
  resolveBusinessDataScope,
  resolveLinkedSiteIdForDraft,
  siteScopeBlockedMessage,
  type BusinessDataScope,
} from '../draftBusinessContext'
import type { PublishedSite, SiteIntegrations } from '../types'

const sites = ref<PublishedSite[]>([])
const draftId = ref('')
const scope = ref<BusinessDataScope>('draft')
const siteId = ref('')
const form = ref<SiteIntegrations>({
  adsAccountId: '',
  adsConnected: false,
  gaPropertyId: '',
  gaConnected: false,
})
const error = ref('')
const message = ref('')
const busy = ref(false)

const ready = computed(() => businessViewReady(scope.value, siteId.value))

const linkedSiteName = computed(
  () => sites.value.find((s) => s.siteId === siteId.value)?.name ?? siteId.value,
)

async function load() {
  if (!ready.value || !draftId.value) return
  const data = await api<{ integrations: SiteIntegrations }>(
    'GET',
    integrationsPath(scope.value, draftId.value, siteId.value),
  )
  form.value = {
    adsAccountId: data.integrations?.adsAccountId ?? '',
    adsConnected: Boolean(data.integrations?.adsConnected),
    gaPropertyId: data.integrations?.gaPropertyId ?? '',
    gaConnected: Boolean(data.integrations?.gaConnected),
    updatedAt: data.integrations?.updatedAt,
  }
}

onMounted(async () => {
  try {
    draftId.value = requireSelectedDraftId()
    sites.value = await listPublishedSites()
    const draft = await fetchDraft(draftId.value)
    scope.value = resolveBusinessDataScope(draft.siteId)
    siteId.value = resolveLinkedSiteIdForDraft(sites.value, draft.siteId)
    if (!businessViewReady(scope.value, siteId.value)) {
      error.value = siteScopeBlockedMessage()
      return
    }
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

watch([siteId, scope], async () => {
  try {
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

async function save() {
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    const data = await api<{ integrations: SiteIntegrations }>(
      'PATCH',
      integrationsPath(scope.value, draftId.value, siteId.value),
      {
        adsAccountId: form.value.adsAccountId.trim(),
        adsConnected: form.value.adsConnected,
        gaPropertyId: form.value.gaPropertyId.trim(),
        gaConnected: form.value.gaConnected,
      },
    )
    form.value = data.integrations
    message.value = '已保存绑定'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function disconnectAds() {
  form.value.adsConnected = false
  form.value.adsAccountId = ''
  await save()
  message.value = '已断开 Google Ads'
}

async function disconnectGa() {
  form.value.gaConnected = false
  form.value.gaPropertyId = ''
  await save()
  message.value = '已断开 GA'
}

async function bindAds() {
  if (!form.value.adsAccountId.trim()) {
    error.value = '请填写 Google Ads 账户 ID'
    return
  }
  form.value.adsConnected = true
  await save()
}

async function bindGa() {
  if (!form.value.gaPropertyId.trim()) {
    error.value = '请填写 GA Property ID'
    return
  }
  form.value.gaConnected = true
  await save()
}
</script>

<template>
  <section class="panel">
    <h1>广告 / 分析</h1>
    <p v-if="scope === 'draft'" class="muted" data-testid="integrations-scope-draft">
      当前草稿的历史集成配置（含迁移数据）；未发布草稿不按其他已发布网站展示。
    </p>
    <p v-else class="muted" data-testid="integrations-scope-site">
      草稿关联网站「{{ linkedSiteName }}」的线上 Ads / GA 绑定。
    </p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>
  </section>

  <section v-if="ready" class="panel">
    <h2>Google Ads</h2>
    <p>
      状态：
      <span class="badge" :class="form.adsConnected ? 'published' : 'draft'">
        {{ form.adsConnected ? '已连接' : '未连接' }}
      </span>
    </p>
    <label>
      Ads 账户 ID
      <input v-model="form.adsAccountId" placeholder="例如 123-456-7890" />
    </label>
    <div class="row">
      <button type="button" :disabled="busy" @click="bindAds">绑定 / 更新</button>
      <button type="button" class="ghost" :disabled="busy" @click="disconnectAds">断开</button>
    </div>
  </section>

  <section v-if="ready" class="panel">
    <h2>Google Analytics</h2>
    <p>
      状态：
      <span class="badge" :class="form.gaConnected ? 'published' : 'draft'">
        {{ form.gaConnected ? '已连接' : '未连接' }}
      </span>
    </p>
    <label>
      GA Property ID
      <input v-model="form.gaPropertyId" placeholder="例如 123456789" />
    </label>
    <div class="row">
      <button type="button" :disabled="busy" @click="bindGa">绑定 / 更新</button>
      <button type="button" class="ghost" :disabled="busy" @click="disconnectGa">断开</button>
    </div>
  </section>
</template>

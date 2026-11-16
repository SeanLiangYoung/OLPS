<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { fetchDraft, listPublishedSites, requireSelectedDraftId } from '../draft'
import {
  businessViewReady,
  resolveBusinessDataScope,
  resolveLinkedSiteIdForDraft,
  siteScopeBlockedMessage,
  type BusinessDataScope,
} from '../draftBusinessContext'
import type { PublishedSite } from '../types'

interface GoogleStatus {
  configured: boolean
  adsConfigured: boolean
  connected: boolean
  adsConnected: boolean
  gaConnected: boolean
  adsAccountId: string
  gaPropertyId: string
}
interface AnalyticsReport {
  rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>
}
interface AdsReport {
  results?: Array<{ campaign?: { id?: string; name?: string; status?: string }; metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number } }>
  nextPageToken?: string
}

const sites = ref<PublishedSite[]>([])
const draftId = ref('')
const scope = ref<BusinessDataScope>('draft')
const siteId = ref('')
const form = ref<GoogleStatus>({
  configured: false,
  adsConfigured: false,
  connected: false,
  adsAccountId: '',
  adsConnected: false,
  gaPropertyId: '',
  gaConnected: false,
})
const error = ref('')
const message = ref('')
const busy = ref(false)
const analyticsReport = ref<AnalyticsReport | null>(null)
const adsReport = ref<AdsReport | null>(null)
const boundAdsAccountId = ref('')
const boundGaPropertyId = ref('')

const ready = computed(() => businessViewReady(scope.value, siteId.value))
const googlePath = computed(() => scope.value === 'draft'
  ? `/api/drafts/${draftId.value}/google`
  : `/api/sites/${siteId.value}/google`)

const linkedSiteName = computed(
  () => sites.value.find((s) => s.siteId === siteId.value)?.name ?? siteId.value,
)

async function load() {
  if (!ready.value || !draftId.value) return
  const data = await api<{ google: GoogleStatus }>('GET', googlePath.value)
  form.value = data.google
  boundAdsAccountId.value = data.google.adsAccountId
  boundGaPropertyId.value = data.google.gaPropertyId
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
    if (new URLSearchParams(window.location.search).get('google') === 'connected') {
      message.value = 'Google 授权已完成，请选择需要查询的资源'
      window.history.replaceState(null, '', window.location.pathname)
    }
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

watch(() => form.value.adsAccountId, () => { adsReport.value = null })
watch(() => form.value.gaPropertyId, () => { analyticsReport.value = null })

async function perform(operation: () => Promise<void>) {
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    await operation()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function authorize() {
  await perform(async () => {
    const data = await api<{ url: string }>('POST', `${googlePath.value}/authorize`)
    window.location.assign(data.url)
  })
}

async function disconnect() {
  if (!window.confirm('确认撤销 Google 账户授予本应用的访问权限？Google Ads 和 Analytics 将同时断开。同一账户在其他网站的授权也可能需要重新完成。')) return
  await perform(async () => {
    await api('DELETE', googlePath.value)
    analyticsReport.value = null
    adsReport.value = null
    await load()
    message.value = 'Google 授权已撤销'
  })
}

async function bind(service: 'ads' | 'ga') {
  await perform(async () => {
    const resources = service === 'ads'
      ? { adsAccountId: form.value.adsAccountId.trim() }
      : { gaPropertyId: form.value.gaPropertyId.trim() }
    const data = await api<{ google: GoogleStatus }>('PATCH', `${googlePath.value}/resources`, resources)
    form.value = data.google
    boundAdsAccountId.value = data.google.adsAccountId
    boundGaPropertyId.value = data.google.gaPropertyId
    if (service === 'ads') adsReport.value = null
    else analyticsReport.value = null
    message.value = '已验证资源访问权限并保存绑定'
  })
}

async function queryAnalytics() {
  await perform(async () => {
    const data = await api<{ report: AnalyticsReport }>('GET', `${googlePath.value}/analytics`)
    analyticsReport.value = data.report
  })
}

async function queryAds(nextPage = false) {
  await perform(async () => {
    const pageToken = nextPage ? adsReport.value?.nextPageToken : undefined
    const suffix = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''
    const data = await api<{ report: AdsReport }>('GET', `${googlePath.value}/ads${suffix}`)
    adsReport.value = nextPage
      ? { ...data.report, results: [...(adsReport.value?.results ?? []), ...(data.report.results ?? [])] }
      : data.report
  })
}
</script>

<template>
  <section class="panel">
    <h1>广告 / 分析</h1>
    <p v-if="scope === 'draft'" class="muted">
      当前草稿的广告与分析绑定。
    </p>
    <p v-else class="muted">
      关联网站「{{ linkedSiteName }}」的线上 Ads / GA 绑定。
    </p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>
  </section>

  <section v-if="ready" class="panel">
    <h2>Google 授权</h2>
    <p>授权后可以验证 Google Ads 账户及 Analytics Property 的访问权限并查询数据。</p>
    <p v-if="!form.configured" class="muted">服务端尚未配置 Google OAuth 客户端、回调地址及令牌加密密钥。</p>
    <p>{{ form.connected ? '已完成 Google 授权' : '尚未完成 Google 授权' }}</p>
    <div class="row">
      <button type="button" :disabled="busy || !form.configured" @click="authorize">{{ form.connected ? '重新授权 Google' : '授权 Google' }}</button>
      <button type="button" class="ghost" :disabled="busy || !form.connected" @click="disconnect">撤销 Google 授权</button>
    </div>
  </section>

  <section v-if="ready" class="panel">
    <h2>Google Ads</h2>
    <p>
      状态：
      <span class="badge" :class="form.adsConnected ? 'published' : 'draft'">
        {{ form.adsConnected ? '已授权' : '未授权' }}
      </span>
    </p>
    <label>
      Ads 账户 ID
      <input v-model="form.adsAccountId" placeholder="例如 123-456-7890" />
    </label>
    <div class="row">
      <button type="button" :disabled="busy || !form.adsConnected || !form.adsConfigured" @click="bind('ads')">验证并保存账户</button>
      <button type="button" class="ghost" :disabled="busy || !form.adsConnected || !form.adsConfigured || !boundAdsAccountId || form.adsAccountId.trim().replaceAll('-', '') !== boundAdsAccountId" @click="queryAds(false)">查询最近 30 天</button>
    </div>
    <p v-if="!form.adsConfigured" class="muted">服务端尚未配置 Google Ads developer token。</p>
    <template v-if="adsReport">
      <p v-if="!adsReport.results?.length">指定日期内没有广告数据。</p>
      <table v-else>
        <thead><tr><th>Campaign</th><th>状态</th><th>展示次数</th><th>点击次数</th><th>费用（micros）</th><th>转化次数</th></tr></thead>
        <tbody><tr v-for="row in adsReport.results" :key="row.campaign?.id">
          <td>{{ row.campaign?.name }}</td><td>{{ row.campaign?.status }}</td><td>{{ row.metrics?.impressions ?? '—' }}</td><td>{{ row.metrics?.clicks ?? '—' }}</td><td>{{ row.metrics?.costMicros ?? '—' }}</td><td>{{ row.metrics?.conversions ?? '—' }}</td>
        </tr></tbody>
      </table>
      <button v-if="adsReport.nextPageToken" type="button" :disabled="busy" @click="queryAds(true)">加载更多广告数据</button>
    </template>
  </section>

  <section v-if="ready" class="panel">
    <h2>Google Analytics</h2>
    <p>
      状态：
      <span class="badge" :class="form.gaConnected ? 'published' : 'draft'">
        {{ form.gaConnected ? '已授权' : '未授权' }}
      </span>
    </p>
    <label>
      GA Property ID
      <input v-model="form.gaPropertyId" placeholder="例如 123456789" />
    </label>
    <div class="row">
      <button type="button" :disabled="busy || !form.gaConnected" @click="bind('ga')">验证并保存 Property</button>
      <button type="button" class="ghost" :disabled="busy || !form.gaConnected || !boundGaPropertyId || form.gaPropertyId.trim() !== boundGaPropertyId" @click="queryAnalytics">查询最近 28 天</button>
    </div>
    <template v-if="analyticsReport">
      <p v-if="!analyticsReport.rows?.length">指定日期内没有分析数据。</p>
      <table v-else>
        <thead><tr><th>日期</th><th>活跃用户</th><th>会话次数</th><th>页面浏览次数</th></tr></thead>
        <tbody><tr v-for="row in analyticsReport.rows" :key="row.dimensionValues?.[0]?.value">
          <td>{{ row.dimensionValues?.[0]?.value }}</td><td>{{ row.metricValues?.[0]?.value ?? '—' }}</td><td>{{ row.metricValues?.[1]?.value ?? '—' }}</td><td>{{ row.metricValues?.[2]?.value ?? '—' }}</td>
        </tr></tbody>
      </table>
    </template>
  </section>
</template>

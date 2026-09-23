<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { ensureSite } from '../site'
import type { SiteIntegrations } from '../types'

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

async function load() {
  const data = await api<{ integrations: SiteIntegrations }>('GET', `/api/sites/${siteId.value}/integrations`)
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
    const site = await ensureSite()
    siteId.value = site.siteId
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
      `/api/sites/${siteId.value}/integrations`,
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
    <p class="muted">绑定 Google Ads 账户与 GA Property，供投放与分析使用。</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>
    <p class="muted">站点：{{ siteId }}</p>
  </section>

  <section class="panel">
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

  <section class="panel">
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

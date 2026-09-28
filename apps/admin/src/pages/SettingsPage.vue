<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { fetchDraft, requireSelectedDraftId } from '../draft'
import type { SiteDraft, SiteSettings } from '../types'

type DraftWithSettings = SiteDraft & { settings: SiteSettings }

const draftId = ref('')
const draft = ref<DraftWithSettings | null>(null)
const localesText = ref('en')
const error = ref('')
const message = ref('')
const busy = ref(false)

async function loadDraft(id: string) {
  const data = await fetchDraft(id)
  draft.value = data as DraftWithSettings
  localesText.value = data.settings.locales.join(', ')
}

onMounted(async () => {
  try {
    const id = requireSelectedDraftId()
    draftId.value = id
    await loadDraft(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

async function save() {
  if (!draft.value) return
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    const locales = localesText.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!locales.length) {
      throw new Error('至少填写一种语言')
    }
    const data = await api<{ draft: DraftWithSettings }>(
      'PATCH',
      `/api/drafts/${draft.value.draftId}/settings`,
      {
        settings: {
          ...draft.value.settings,
          locales,
          defaultLocale: locales[0],
        },
      },
    )
    draft.value = data.draft
    localesText.value = data.draft.settings.locales.join(', ')
    message.value = '已保存草稿站点配置'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="panel">
    <h1>设置</h1>
    <p class="muted">配置作用于当前 sandbox 草稿，推送成功后才会影响线上网站。</p>
    <p v-if="draft">草稿：{{ draft.name }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <div v-if="draft" class="grid-2">
      <label>
        默认语言
        <input v-model="draft.settings.defaultLocale" />
      </label>
      <label>
        语言列表（逗号分隔）
        <input v-model="localesText" />
      </label>
      <label>
        屏数上限
        <input v-model.number="draft.settings.screenCap" type="number" />
      </label>
      <label class="row">
        <input v-model="draft.settings.analyticsEnabled" type="checkbox" style="width:auto" />
        启用分析采集
      </label>
      <label class="row">
        <input v-model="draft.settings.mapsEnabled" type="checkbox" style="width:auto" />
        启用地图
      </label>
      <label>
        地图 API Key
        <input v-model="draft.settings.mapsApiKey" />
      </label>
      <label class="row">
        <input v-model="draft.settings.whatsappEnabled" type="checkbox" style="width:auto" />
        启用 WhatsApp
      </label>
      <label>
        WhatsApp 号码
        <input v-model="draft.settings.whatsappNumber" />
      </label>
      <label>
        WhatsApp 按钮文案
        <input v-model="draft.settings.whatsappLabel" />
      </label>
    </div>
    <button v-if="draft" type="button" :disabled="busy" @click="save">保存</button>
  </section>
</template>

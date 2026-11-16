<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { fetchDraft, requireSelectedDraftId } from '../draft'
import { buildDraftSettingsForSave } from '../settingsLocales'
import PublicationPanel from '../components/PublicationPanel.vue'
import OwnersPanel from '../components/OwnersPanel.vue'
import type { SiteDraft, SiteSettings } from '../types'

type DraftWithSettings = SiteDraft & { settings: SiteSettings }

const draftId = ref('')
const draft = ref<DraftWithSettings | null>(null)
const localesText = ref('en')
const error = ref('')
const message = ref('')
const busy = ref(false)
const savedSettings = ref('')
const settingsDirty = computed(() => savedSettings.value !== JSON.stringify({ settings: draft.value?.settings, locales: localesText.value }))

async function loadDraft(id: string) {
  const data = await fetchDraft(id)
  draft.value = data as DraftWithSettings
  localesText.value = data.settings.locales.join(', ')
  savedSettings.value = JSON.stringify({ settings: draft.value.settings, locales: localesText.value })
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
    const settings = buildDraftSettingsForSave(
      draft.value.settings,
      localesText.value,
    )
    const data = await api<{ draft: DraftWithSettings }>(
      'PATCH',
      `/api/drafts/${draft.value.draftId}/settings`,
      settings,
    )
    draft.value = data.draft
    localesText.value = data.draft.settings.locales.join(', ')
    savedSettings.value = JSON.stringify({ settings: draft.value.settings, locales: localesText.value })
    message.value = '已保存网站设置，发布后公开生效'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="panel">
    <h1>网站设置</h1>
    <p class="muted">保存设置后，单独确认发布即可更新网站共用配置。</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <div v-if="draft" class="grid-2">
      <label>
        默认语言
        <select v-model="draft.settings.defaultLocale"><option v-for="locale in localesText.split(',').map(value => value.trim()).filter(Boolean)" :key="locale" :value="locale">{{ locale }}</option></select>
      </label>
      <label>
        语言列表（逗号分隔）
        <input v-model="localesText" />
      </label>
      <label>
        广告页最多内容屏幕数量
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
      <label>
        地图地址或地点名称
        <input v-model="draft.settings.mapsQuery" placeholder="输入访客需要查看的地点" />
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
    <PublicationPanel v-if="draft" :draft-id="draft.draftId" :page-ids="[]" :include-settings="true" label="发布网站设置" :disabled="busy || settingsDirty" />
    <p v-if="draft && settingsDirty" class="muted">当前设置尚未保存，保存后可以发布。</p>
  </section>
  <section v-if="draft" class="panel"><h2>成员与权限</h2><details><summary>当前编辑版本的成员</summary><OwnersPanel scope="draft" :resource-id="draft.draftId" /></details><details v-if="draft.siteId"><summary>网站成员</summary><OwnersPanel scope="site" :resource-id="draft.siteId" /></details><p><RouterLink to="/workspace">管理网站与其他编辑版本</RouterLink></p></section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { ensureSite, listSites, setStoredSiteId } from '../site'
import type { Site, SiteSettings } from '../types'

type SiteWithSettings = Site & { settings: SiteSettings }

const sites = ref<Site[]>([])
const siteId = ref('')
const site = ref<SiteWithSettings | null>(null)
const localesText = ref('en')
const error = ref('')
const message = ref('')
const busy = ref(false)

async function loadSite(id: string) {
  const data = await api<{ site: SiteWithSettings }>('GET', `/api/sites/${id}`)
  site.value = data.site
  localesText.value = data.site.settings.locales.join(', ')
}

onMounted(async () => {
  try {
    const current = await ensureSite()
    sites.value = await listSites()
    siteId.value = current.siteId
    await loadSite(current.siteId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

async function onSiteChange() {
  setStoredSiteId(siteId.value)
  error.value = ''
  try {
    await loadSite(siteId.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function save() {
  if (!site.value) return
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
    const data = await api<{ site: SiteWithSettings }>(
      'PATCH',
      `/api/sites/${site.value.siteId}/settings`,
      {
        ...site.value.settings,
        locales,
        defaultLocale: locales[0]!,
      },
    )
    site.value = data.site
    localesText.value = data.site.settings.locales.join(', ')
    message.value = '设置已保存'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function createSite() {
  error.value = ''
  try {
    const name = window.prompt('新站点名称', 'New Site')
    if (!name?.trim()) return
    const data = await api<{ site: SiteWithSettings }>('POST', '/api/sites', { name: name.trim() })
    sites.value = await listSites()
    siteId.value = data.site.siteId
    setStoredSiteId(siteId.value)
    await loadSite(siteId.value)
    message.value = '站点已创建'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <section v-if="site" class="panel">
    <div class="row" style="justify-content: space-between;">
      <h1 style="margin: 0;">站点设置</h1>
      <button type="button" class="secondary" @click="createSite">新建站点</button>
    </div>
    <label style="max-width: 360px; margin-top: 0.75rem;">
      当前站点
      <select v-model="siteId" @change="onSiteChange">
        <option v-for="s in sites" :key="s.siteId" :value="s.siteId">
          {{ s.name }} ({{ s.siteId.slice(0, 8) }})
        </option>
      </select>
    </label>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>
  </section>

  <section v-if="site" class="panel">
    <h2>语言</h2>
    <label>
      语言列表（逗号分隔，第一项为默认语言）
      <input v-model="localesText" placeholder="en, zh" />
    </label>
    <p class="muted">默认语言：{{ localesText.split(',')[0]?.trim() || '—' }}</p>
  </section>

  <section v-if="site" class="panel">
    <h2>广告页屏数上限</h2>
    <label>
      screenCap
      <input v-model.number="site.settings.screenCap" type="number" min="1" />
    </label>
  </section>

  <section v-if="site" class="panel">
    <h2>分析采集</h2>
    <label class="row">
      <input v-model="site.settings.analyticsEnabled" type="checkbox" style="width:auto" />
      启用站内行为采集
    </label>
    <p class="muted">广告账户与 GA Property 请到「广告/分析」模块绑定。</p>
    <RouterLink to="/integrations">前往广告/分析</RouterLink>
  </section>

  <section v-if="site" class="panel">
    <h2>地图</h2>
    <label class="row">
      <input v-model="site.settings.mapsEnabled" type="checkbox" style="width:auto" />
      启用 Google 地图
    </label>
    <label v-if="site.settings.mapsEnabled">
      Maps API Key
      <input v-model="site.settings.mapsApiKey" />
    </label>
  </section>

  <section v-if="site" class="panel">
    <h2>WhatsApp</h2>
    <label class="row">
      <input v-model="site.settings.whatsappEnabled" type="checkbox" style="width:auto" />
      启用 WhatsApp
    </label>
    <label v-if="site.settings.whatsappEnabled">
      号码
      <input v-model="site.settings.whatsappNumber" placeholder="+8613800138000" />
    </label>
    <label v-if="site.settings.whatsappEnabled">
      展示文案
      <input v-model="site.settings.whatsappLabel" placeholder="Chat on WhatsApp" />
    </label>
  </section>

  <section v-if="site" class="panel">
    <button type="button" :disabled="busy" @click="save">保存全部设置</button>
  </section>

  <section v-if="!site && error" class="panel">
    <p class="error">{{ error }}</p>
  </section>
</template>

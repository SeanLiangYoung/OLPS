<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { selectSite, selectDraft, siteDrafts, type CmsSite, type CmsDraft } from '../cms-state'

const router = useRouter()
const sites = ref<CmsSite[]>([])
const name = ref('')
const creating = ref(false)
const error = ref('')
const preparing = ref<{ site: CmsSite; draftId: string; failed: boolean } | null>(null)
const drafts = ref<CmsDraft[]>([])
const selectedSite = ref<CmsSite | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
let selectionVersion = 0

async function load(): Promise<void> {
  const result = await api<{ sites: CmsSite[] }>('GET', '/api/sites')
  if (!disposed) sites.value = result.sites
}
onMounted(() => load().catch(reason => { error.value = reason.message }))
onBeforeUnmount(() => { disposed = true; selectionVersion++; clearTimeout(timer) })

async function enter(site: CmsSite): Promise<void> {
  if (disposed) return
  const version = ++selectionVersion
  clearTimeout(timer)
  preparing.value = null
  error.value = ''
  try {
    selectedSite.value = site
    const available = await siteDrafts(site.siteId)
    if (disposed || version !== selectionVersion) return
    drafts.value = available
    const ready = drafts.value.find(draft => draft.initStatus === 'ready')
    if (ready) { selectSite(site); selectDraft(ready); await router.push('/dashboard'); return }
    const current = drafts.value[0]
    if (!current) throw new Error('网站没有可用的编辑版本')
    preparing.value = { site, draftId: current.draftId, failed: current.initStatus === 'failed' }
    if (!preparing.value.failed) await poll()
  } catch (reason) { if (!disposed && version === selectionVersion) error.value = reason instanceof Error ? reason.message : String(reason) }
}

async function poll(): Promise<void> {
  if (disposed || !preparing.value) return
  const current = preparing.value
  const version = selectionVersion
  try {
    const state = await api<{ initStatus: string }>('GET', `/api/sites/${preparing.value.site.siteId}/initialization`)
    if (disposed || version !== selectionVersion || preparing.value !== current) return
    if (state.initStatus === 'ready') { const site = preparing.value.site; preparing.value = null; await load(); if (!disposed && version === selectionVersion) await enter(site); return }
    if (state.initStatus === 'failed') { preparing.value.failed = true; return }
    timer = setTimeout(() => { void poll() }, 1000)
  } catch (reason) { if (!disposed && version === selectionVersion) error.value = reason instanceof Error ? reason.message : String(reason) }
}

async function create(): Promise<void> {
  if (creating.value || preparing.value || !name.value.trim()) return
  const version = ++selectionVersion
  creating.value = true
  error.value = ''
  try {
    const result = await api<{ site: CmsSite; draft: { draftId: string } }>('POST', '/api/sites', { name: name.value.trim() })
    if (disposed || version !== selectionVersion) return
    preparing.value = { site: result.site, draftId: result.draft.draftId, failed: false }
    name.value = ''
    await load()
    if (disposed || version !== selectionVersion) return
    await poll()
  } catch (reason) { if (!disposed && version === selectionVersion) error.value = reason instanceof Error ? reason.message : String(reason) }
  finally { creating.value = false }
}

function cancelPreparation(): void { selectionVersion++; preparing.value = null; clearTimeout(timer) }

async function retry(): Promise<void> {
  if (!preparing.value) return
  const version = selectionVersion
  error.value = ''
  try {
    preparing.value.failed = false
    await api('POST', `/api/sites/${preparing.value.site.siteId}/initialization/retry`)
    if (disposed || version !== selectionVersion) return
    await poll()
  } catch (reason) { if (!disposed && version === selectionVersion) error.value = reason instanceof Error ? reason.message : String(reason) }
}
</script>

<template>
  <main class="cms-sites">
    <header><h1>我的网站</h1><p>选择要管理的网站，或者创建一个新网站。</p></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <section class="panel">
      <h2>创建网站</h2>
      <form @submit.prevent="create"><label>网站名称<input v-model="name" required maxlength="200" placeholder="例如：我的公司网站"></label><button :disabled="creating || !!preparing || !name.trim()">{{ creating ? '正在创建…' : '创建网站' }}</button></form>
    </section>
    <section v-if="preparing" class="panel" aria-live="polite">
      <h2>{{ preparing.site.name }}</h2>
      <p v-if="preparing.failed" role="alert">网站准备失败，请重试。</p><p v-else>正在准备页面、主题和网站功能…</p>
      <button v-if="preparing.failed" @click="retry">重新准备网站</button>
      <button class="secondary" @click="cancelPreparation">返回网站列表</button>
    </section>
    <section class="cms-site-grid" aria-label="网站列表">
      <article v-for="site in sites" :key="site.siteId" class="panel"><h2>{{ site.name }}</h2><p>{{ site.status === 'published' ? '已经发布' : '尚未发布' }}</p><button @click="enter(site)">进入网站</button><a v-if="site.publicUrl && site.status === 'published'" :href="site.publicUrl" target="_blank" rel="noopener">查看网站</a></article>
      <p v-if="!sites.length">尚未创建网站。</p>
    </section>
  </main>
</template>

<style scoped>
.cms-sites{max-width:1120px;margin:48px auto;padding:0 24px}.cms-site-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}form{display:flex;gap:16px;align-items:end}form label{flex:1}article a{margin-left:16px}
</style>

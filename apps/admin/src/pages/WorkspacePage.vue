<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, setSelectedDraftId } from '../api'
import { createDraft } from '../draft'
import { recalledSiteDraft, rememberSiteDraft, type ManagedSite } from '../siteManagement'
import type { SiteDraft } from '../types'

const router = useRouter()
const sites = ref<ManagedSite[]>([])
const error = ref('')
const loading = ref(true)
const busy = ref(false)
const name = ref('')
const createFromSiteId = ref('')
const choosing = ref('')

async function reload() {
  loading.value = true
  error.value = ''
  try { sites.value = (await api<{ sites: ManagedSite[] }>('GET', '/api/managed-sites')).sites }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { loading.value = false }
}
onMounted(reload)

function openDraft(draft: SiteDraft) {
  if (draft.siteId) rememberSiteDraft(draft.siteId, draft.draftId)
  setSelectedDraftId(draft.draftId)
  router.push('/dashboard')
}
function openSite(site: ManagedSite) {
  const remembered = recalledSiteDraft(site.siteId, site.drafts)
  const draft = site.drafts.find(item => item.draftId === remembered) || (site.drafts.length === 1 ? site.drafts[0] : undefined)
  if (draft) openDraft(draft)
  else choosing.value = choosing.value === site.siteId ? '' : site.siteId
}
async function create() {
  if (!name.value.trim()) { error.value = '请填写网站名称'; return }
  busy.value = true
  error.value = ''
  try {
    const draft = await createDraft({ name: name.value.trim(), ...(createFromSiteId.value ? { siteId: createFromSiteId.value } : {}) })
    await reload()
    openDraft(sites.value.flatMap(site => site.drafts).find(item => item.draftId === draft.draftId) || draft)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
</script>

<template>
  <main class="workspace-page">
    <div class="workspace-content">
      <header class="workspace-header"><RouterLink class="brand" to="/workspace">OLPS · 网站管理</RouterLink><RouterLink to="/login">账号登录</RouterLink></header>
      <div class="page-heading"><div><h1>我的网站</h1><p class="muted">选择网站，继续编辑内容、处理询盘和发布更新。</p></div><a class="btn" href="#new-site">新建网站</a></div>
      <p v-if="loading" role="status">正在读取网站…</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div v-if="!loading" class="site-grid">
        <section v-for="site in sites" :key="site.siteId" class="site-card">
          <div class="site-avatar" aria-hidden="true">{{ site.name.slice(0, 1) }}</div>
          <div><h2>{{ site.name }}</h2><span class="badge" :class="site.publishedCommitId ? 'published' : 'draft'">{{ site.publishedCommitId ? '网站已发布' : '尚未首次发布' }}</span></div>
          <p v-if="site.publicUrl && site.publishedCommitId"><a :href="site.publicUrl" target="_blank" rel="noopener">查看网站 ↗</a></p><p v-else class="muted">编辑内容准备好后即可发布。</p>
          <p class="muted">{{ site.drafts.length }} 个编辑版本 · {{ site.updatedAt ? new Date(site.updatedAt).toLocaleDateString('zh-CN') : '尚无更新' }}</p>
          <button type="button" @click="openSite(site)">管理网站</button>
          <button v-if="site.drafts.length > 1" type="button" class="ghost" @click="choosing = choosing === site.siteId ? '' : site.siteId">选择编辑版本</button>
          <div v-if="choosing === site.siteId" class="version-picker"><h3>选择编辑版本</h3><button v-for="draft in site.drafts" :key="draft.draftId" type="button" class="ghost" @click="openDraft(draft)">{{ draft.name }}</button><p v-if="!site.drafts.length" class="muted">选择下方“已有网站”创建可编辑版本。</p></div>
        </section>
      </div>
      <section v-if="!loading && !sites.length" class="panel empty-state"><h2>创建你的网站</h2><p>填写名称，开始添加内容和页面。</p></section>
      <section id="new-site" class="panel new-site"><h2>新建网站或编辑版本</h2><div class="grid-2"><label>名称<input v-model="name" placeholder="例如：春季活动站" /></label><label>已有网站（可选）<select v-model="createFromSiteId"><option value="">建立新网站</option><option v-for="site in sites" :key="site.siteId" :value="site.siteId">{{ site.name }}</option></select></label></div><button type="button" :disabled="busy" @click="create">{{ busy ? '正在创建…' : createFromSiteId ? '创建编辑版本' : '创建网站' }}</button></section>
    </div>
  </main>
</template>

<style scoped>
.workspace-page { margin: 0; min-height: 100vh; padding: 2rem; max-width: none; }
.workspace-content { width: min(1200px, 100%); margin: 0 auto; }
.workspace-header { display: flex; justify-content: space-between; padding-bottom: 3rem; align-items: center; }
.site-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 1.25rem; margin-bottom: 2rem; }
.site-card { background: white; border: 1px solid var(--line); border-radius: 14px; padding: 1.4rem; }
.site-card h2 { margin: .5rem 0; font-size: 1.2rem; }
.site-avatar { display: grid; place-items: center; background: #e9f2ff; color: #1765c1; font-size: 1.6rem; width: 3.5rem; height: 3.5rem; border-radius: 12px; margin-bottom: 1rem; }
.version-picker { display: grid; gap: .5rem; margin-top: 1rem; border-top: 1px solid var(--line); }
.new-site { max-width: 750px; }
@media (max-width: 600px) { .workspace-page { padding: 1rem; } .workspace-header { padding-bottom: 2rem; } }
</style>

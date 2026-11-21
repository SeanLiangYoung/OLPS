<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, ApiError, logoutApi, setSelectedDraftId, getSelectedDraftId } from './api'
import { selectedSiteIdState, selectedSiteNameState, selectedDraftIdState, selectedDraftNameState, currentUserState, setCurrentUser } from './workspaceSession'
import { contentLocale, selectLocale, siteDrafts, selectDraft, type CmsSite, type CmsDraft } from './cms-state'

const route = useRoute()
const router = useRouter()
const showShell = computed(() => route.path !== '/login' && route.path !== '/sites')
const drafts = ref<CmsDraft[]>([])
const collections = ref<Array<{ meta: { collectionId: string }; locale: { title: string } }>>([])
const locales = ref<Array<{ code: string; dir: string }>>([])
const site = ref<CmsSite | null>(null)
const error = ref('')
const previewBusy = ref(false)
const creatingDraft = ref(false)
const draftName = ref('')
const draftBusy = ref(false)
let generation = 0

async function refresh(): Promise<void> {
  if (!showShell.value || !selectedSiteIdState.value || !getSelectedDraftId()) return
  const current = ++generation
  const siteId = selectedSiteIdState.value
  const draftId = getSelectedDraftId()
  error.value = ''
  try {
    const [siteData, available, user, types, settings] = await Promise.all([
      api<{ site: CmsSite }>('GET', `/api/sites/${siteId}`), siteDrafts(siteId),
      api<{ user: NonNullable<typeof currentUserState.value> }>('GET', '/api/auth/me'),
      api<{ collections: typeof collections.value }>('GET', `/api/drafts/${draftId}/collections?locale=${contentLocale.value}`),
      api<{ settings: { locales: typeof locales.value } }>('GET', `/api/drafts/${draftId}/settings`),
    ])
    if (current !== generation) return
    site.value = siteData.site; selectedSiteNameState.value = siteData.site.name
    drafts.value = available; setCurrentUser(user.user); collections.value = types.collections; locales.value = settings.settings.locales
    selectedDraftNameState.value = available.find(entry => entry.draftId === draftId)?.name ?? ''
  } catch (reason) {
    if (current !== generation) return
    if (reason instanceof ApiError && reason.status === 401) { await logoutApi(); await router.push('/login'); return }
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}
onMounted(refresh)
watch([selectedDraftIdState, selectedSiteIdState, contentLocale, () => showShell.value], refresh)
function changeDraft(event: Event): void {
  const draft = drafts.value.find(entry => entry.draftId === (event.target as HTMLSelectElement).value)
  if (!draft) throw new Error('所选编辑版本不存在')
  selectDraft(draft)
  void router.push('/dashboard')
}
async function preview(): Promise<void> {
  if (previewBusy.value) return
  previewBusy.value = true; error.value = ''
  try {
    const result = await api<{ previewUrl: string }>('POST', `/api/drafts/${getSelectedDraftId()}/preview`, { locale: contentLocale.value, returnPath: route.fullPath })
    window.location.assign(result.previewUrl)
  } catch (reason) { error.value = (reason as Error).message } finally { previewBusy.value = false }
}
async function logout(): Promise<void> { await logoutApi(); await router.push('/login') }
async function switchSite(): Promise<void> { setSelectedDraftId(''); await router.push('/sites') }
async function createDraft(): Promise<void> {
  if (draftBusy.value || !draftName.value.trim()) return
  draftBusy.value = true; error.value = ''
  try {
    const result = await api<{ draft: CmsDraft }>('POST', '/api/drafts', { siteId: selectedSiteIdState.value, name: draftName.value.trim() })
    selectDraft(result.draft); creatingDraft.value = false; draftName.value = ''; await router.push('/dashboard'); await refresh()
  } catch (reason) { error.value = (reason as Error).message } finally { draftBusy.value = false }
}
</script>

<template>
  <div class="cms-app">
    <header v-if="showShell" class="cms-topbar">
      <RouterLink class="cms-brand" to="/dashboard">OLPS 网站管理</RouterLink><strong>{{ selectedSiteNameState }}</strong>
      <label class="cms-version">编辑版本<select :value="selectedDraftIdState" aria-label="编辑版本" @change="changeDraft"><option v-for="draft in drafts" :key="draft.draftId" :value="draft.draftId" :disabled="draft.initStatus !== 'ready'">{{ draft.name }}</option></select></label>
      <button class="quiet" @click="creatingDraft = true">创建编辑版本</button>
      <select :value="contentLocale" aria-label="内容语言" @change="selectLocale(($event.target as HTMLSelectElement).value)"><option v-for="locale in locales" :key="locale.code" :value="locale.code">{{ locale.code === 'en' ? 'English' : locale.code === 'zh-CN' ? '简体中文' : locale.code === 'zh-TW' ? '繁體中文' : locale.code }}</option></select>
      <button class="secondary" :disabled="previewBusy" @click="preview">{{ previewBusy ? '正在生成预览…' : '预览网站' }}</button><a v-if="site?.status === 'published' && site.publicUrl" class="btn secondary" :href="site.publicUrl" target="_blank" rel="noopener">查看网站</a><RouterLink class="btn" to="/publish">发布更改</RouterLink>
      <span>{{ currentUserState?.name }}</span><button class="quiet" @click="switchSite">切换网站</button><button class="quiet" @click="logout">退出</button>
    </header>
    <div :class="{ 'cms-layout': showShell }">
      <aside v-if="showShell" class="cms-sidebar"><nav aria-label="网站管理导航">
        <RouterLink to="/dashboard">网站概况</RouterLink><span>网站内容</span><RouterLink to="/pages">页面管理</RouterLink><RouterLink to="/collections">全部内容类型</RouterLink><RouterLink v-for="collection in collections" :key="collection.meta.collectionId" :to="`/collections/${collection.meta.collectionId}`">{{ collection.locale.title }}</RouterLink><RouterLink to="/media">媒体资料</RouterLink><RouterLink to="/knowledge">网站资料</RouterLink><RouterLink to="/generate">AI 建站</RouterLink>
        <span>外观与功能</span><RouterLink to="/appearance/themes">主题</RouterLink><RouterLink to="/appearance/customize">外观定制</RouterLink><RouterLink to="/appearance/menus">导航菜单</RouterLink><RouterLink to="/appearance/texts">固定文字</RouterLink><RouterLink to="/plugins">插件</RouterLink>
        <span>数据与发布</span><RouterLink to="/inquiries">客户询盘</RouterLink><RouterLink to="/reports">统计与报告</RouterLink><RouterLink to="/integrations">营销连接</RouterLink><RouterLink to="/publish">发布记录与协作</RouterLink>
        <span>网站设置</span><RouterLink to="/settings/general">常规设置</RouterLink><RouterLink to="/settings/search">搜索设置</RouterLink><RouterLink to="/settings/content-types">内容类型设置</RouterLink><RouterLink to="/settings/targets">发布目标</RouterLink><RouterLink to="/settings/members">网站成员</RouterLink>
      </nav></aside>
      <main :class="{ 'cms-main': showShell }"><p v-if="error" class="error" role="alert">{{ error }}</p><RouterView :key="selectedSiteIdState" /></main>
    </div>
    <dialog :open="creatingDraft" aria-label="创建编辑版本"><h2>创建编辑版本</h2><p>已经发布的网站使用当前公开版本；尚未发布的网站使用已保存的初始版本。</p><form @submit.prevent="createDraft"><label>版本名称<input v-model="draftName" required maxlength="200"></label><button :disabled="draftBusy">{{ draftBusy ? '正在创建…' : '确认创建' }}</button><button type="button" class="secondary" :disabled="draftBusy" @click="creatingDraft = false">取消</button></form></dialog>
  </div>
</template>

<style>
:root{font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#20342f;background:#f4f6f4;--line:#dce4df;--accent:#16694e;--muted:#66756d}*{box-sizing:border-box}body{margin:0}button,input,select,textarea{font:inherit}button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;border:1px solid var(--accent);border-radius:7px;background:var(--accent);color:white;text-decoration:none;cursor:pointer;font-weight:600}button:disabled{opacity:.5;cursor:default}.secondary{background:white;color:#28523f;border-color:#cbd8d0}.quiet{background:transparent;border-color:transparent;color:inherit;padding:8px}a{color:#16694e}input,select,textarea{border:1px solid #cbd8d0;border-radius:6px;padding:10px;background:white;color:inherit;max-width:100%}input:not([type=checkbox]):not([type=radio]),textarea{width:100%}label{display:block;margin:12px 0}label input,label textarea,label select{display:block;margin-top:7px}label:has(input[type=checkbox]){display:flex;align-items:center;gap:8px}label input[type=checkbox]{display:inline;margin:0}h1{font-size:28px;margin-top:0}h2{font-size:20px}h3{font-size:17px}p{line-height:1.65}.panel{background:white;border:1px solid var(--line);border-radius:10px;padding:24px;margin-bottom:22px}.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.error{color:#a42d32;background:#fff0f0;padding:12px;border-radius:7px}.ok{color:#16694e}.muted{color:var(--muted)}.cms-topbar{min-height:74px;background:white;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:14px;padding:12px 22px;flex-wrap:wrap;position:sticky;top:0;z-index:20}.cms-brand{font-weight:800;color:#18513d;text-decoration:none;margin-right:10px}.cms-version{display:flex;align-items:center;gap:8px;margin:0;font-size:13px}.cms-version select{margin:0}.cms-layout{display:grid;grid-template-columns:230px minmax(0,1fr)}.cms-sidebar{background:#edf2ee;border-right:1px solid var(--line);padding:20px 12px;min-height:calc(100vh - 74px)}.cms-sidebar nav{display:flex;flex-direction:column;gap:4px}.cms-sidebar a{display:block;padding:10px 13px;text-decoration:none;color:#365044;border-radius:6px}.cms-sidebar a.router-link-active{background:#d9e8de;color:#0e593b;font-weight:700}.cms-sidebar span{font-size:12px;color:#768478;padding:20px 13px 5px}.cms-main{padding:30px;min-width:0;max-width:1600px}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:14px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}.table th{font-size:13px;color:#64766c}.badge{font-size:12px;padding:4px 9px;border-radius:12px;background:#e9f1eb}dialog[open]{position:fixed;top:15%;max-height:70vh;overflow:auto;width:min(560px,90vw);padding:28px;border:1px solid var(--line);border-radius:12px;z-index:100;box-shadow:0 15px 80px #0003}summary{cursor:pointer;font-weight:600}details{margin:14px 0}@media(max-width:960px){.cms-layout{grid-template-columns:185px minmax(0,1fr)}.cms-main{padding:20px}.cms-topbar{position:static}}@media(max-width:680px){.cms-layout{display:block}.cms-sidebar{min-height:0}.cms-sidebar nav{display:grid;grid-template-columns:repeat(2,1fr)}.cms-sidebar span{grid-column:1/-1}.cms-main{padding:16px}}
</style>

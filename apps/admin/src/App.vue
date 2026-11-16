<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  api,
  getAccessToken,
  logoutApi,
  setSelectedDraftId,
} from './api'
import { fetchDraft } from './draft'
import type { PublishedSite } from './types'
import {
  currentUserState,
  selectedDraftIdState,
  selectedDraftNameState,
  setCurrentUser,
} from './workspaceSession'

const route = useRoute()
const router = useRouter()
const siteName = ref('')
const publicUrl = ref('')
const showShell = computed(
  () => route.path !== '/login' && route.path !== '/workspace',
)

async function refreshDraftLabel() {
  const id = selectedDraftIdState.value
  publicUrl.value = ''
  siteName.value = ''
  if (!id) {
    selectedDraftNameState.value = ''
    return
  }
  try {
    const draft = await fetchDraft(id)
    if (selectedDraftIdState.value !== id) return
    selectedDraftNameState.value = draft.name
    siteName.value = draft.name
    publicUrl.value = ''
    if (draft.siteId) {
      const data = await api<{ site: PublishedSite }>('GET', `/api/sites/${draft.siteId}`)
      if (selectedDraftIdState.value !== id) return
      siteName.value = data.site.name
      publicUrl.value = data.site.publishedCommitId ? data.site.publicUrl || '' : ''
    }
  } catch {
    if (selectedDraftIdState.value === id) selectedDraftNameState.value = '当前编辑版本'
  }
}

async function refreshCurrentUser() {
  if (!getAccessToken()) {
    setCurrentUser(null)
    return
  }
  try {
    const me = await api<{ user: typeof currentUserState.value }>('GET', '/api/auth/me')
    setCurrentUser(me.user)
  } catch {
    setCurrentUser(null)
  }
}

onMounted(async () => {
  window.addEventListener('olps:published', refreshDraftLabel)
  if (!selectedDraftIdState.value && getAccessToken()) {
    const stored = localStorage.getItem('olps_draft_id')
    if (stored) setSelectedDraftId(stored)
  }
  if (showShell.value) {
    await refreshDraftLabel()
    await refreshCurrentUser()
  }
})
onBeforeUnmount(() => window.removeEventListener('olps:published', refreshDraftLabel))

watch(selectedDraftIdState, () => {
  refreshDraftLabel()
})

watch(
  () => route.path,
  () => {
    if (showShell.value) {
      refreshDraftLabel()
      refreshCurrentUser()
    }
  },
)

async function logout() {
  await logoutApi()
  selectedDraftNameState.value = ''
  await router.push('/login')
}

function switchWorkspace() {
  setSelectedDraftId('')
  selectedDraftNameState.value = ''
  router.push('/workspace')
}
</script>

<template>
  <div class="app">
    <header v-if="showShell" class="top">
      <RouterLink class="brand" to="/workspace">OLPS <span>网站管理</span></RouterLink>
      <div class="site-heading"><strong>{{ siteName || '当前网站' }}</strong><small>编辑版本：{{ selectedDraftNameState || '加载中…' }}</small></div>
      <div class="meta">
        <a v-if="publicUrl" :href="publicUrl" target="_blank" rel="noopener">查看网站 ↗</a>
        <RouterLink class="btn" to="/publish">发布更改</RouterLink>
        <span v-if="currentUserState">{{
          currentUserState.name || currentUserState.account
        }}</span>
        <button type="button" class="ghost" @click="switchWorkspace">切换网站</button>
        <button type="button" class="ghost" @click="logout">退出</button>
      </div>
    </header>
    <aside v-if="showShell" class="sidebar">
      <nav aria-label="网站管理导航">
        <RouterLink to="/dashboard">网站概况</RouterLink>
        <RouterLink to="/pages">页面管理</RouterLink>
        <RouterLink to="/inquiries">客户询盘</RouterLink>
        <span class="nav-section">数据与优化</span>
        <RouterLink to="/reports">统计与报告</RouterLink>
        <RouterLink to="/integrations">广告与分析</RouterLink>
        <span class="nav-section">网站管理</span>
        <RouterLink to="/publish">发布记录与协作</RouterLink>
        <RouterLink to="/settings">网站设置</RouterLink>
      </nav>
      <div class="sidebar-note">编辑内容保存后，可选择准备好的页面发布。</div>
    </aside>
    <main :class="{ 'main--auth': !showShell }">
      <RouterView />
    </main>
  </div>
</template>

<style>
:root {
  --bg: #f4f6f9;
  --ink: #223044;
  --card: #fff;
  --line: #dce3ec;
  --accent: #1765c1;
  --muted: #627188;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", "Noto Sans SC", sans-serif;
  color: var(--ink);
  background: var(--bg);
  min-height: 100vh;
}
a { color: var(--accent); text-decoration: none; }
.app { min-height: 100vh; }
main {
  padding: 1.5rem 2rem;
  margin-left: 224px;
  max-width: 1800px;
}
.main--auth {
  padding: 0;
  max-width: none;
  margin: 0;
}
.top {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 0.8rem 1.25rem;
  border-bottom: 1px solid var(--line);
  background: #fff;
  position: sticky;
  top: 0;
  z-index: 10;
  flex-wrap: wrap;
}
.brand { font-weight: 800; letter-spacing: 0.02em; min-width: 190px; font-size: 1.25rem; }
.brand span { font-weight: 400; font-size: .85rem; color: var(--muted); margin-left: .5rem; }
.site-heading { display: grid; gap: .2rem; flex: 1; }
.site-heading small { color: var(--muted); }
.sidebar { position: fixed; top: 77px; bottom: 0; left: 0; width: 224px; padding: 1.4rem .8rem; background: #fff; border-right: 1px solid var(--line); overflow: auto; }
.sidebar nav { display: grid; gap: .3rem; }
.sidebar nav a { padding: .8rem 1rem; border-radius: 8px; color: #42546b; }
.sidebar nav a.router-link-active { color: var(--accent); background: #eaf2fc; font-weight: 650; }
.nav-section { padding: 1.2rem 1rem .4rem; font-size: .76rem; color: var(--muted); }
.sidebar-note { margin: 2rem 1rem; font-size: .8rem; color: var(--muted); line-height: 1.7; }
.meta { display: flex; gap: 0.8rem; align-items: center; font-size: 0.86rem; }
.panel {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 1.1rem 1.2rem;
  margin-bottom: 1rem;
}
button, .btn {
  background: var(--accent);
  color: #fff;
  border: 0;
  border-radius: 7px;
  padding: 0.55rem 1rem;
  font: inherit;
  font-size: .9rem;
  cursor: pointer;
}
button:disabled { opacity: 0.55; cursor: not-allowed; }
button.secondary { background: #41545c; }
button.ghost {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line);
}
input, textarea, select {
  width: 100%;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
}
label { display: grid; gap: 0.35rem; margin-bottom: 0.75rem; font-size: 0.92rem; }
.grid { display: grid; gap: 0.75rem; }
.grid-2 { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.row { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { text-align: left; padding: 0.55rem 0.4rem; border-bottom: 1px solid var(--line); vertical-align: top; }
.muted { color: #5b6b73; font-size: 0.9rem; }
.error { color: #9b1c1c; }
.ok { color: #0f6a5a; }
.tabs { display: flex; gap: 0.5rem; margin-bottom: 0.8rem; flex-wrap: wrap; }
.tabs button { background: #41545c; }
.tabs button.active { background: var(--accent); }
.stat-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}
.stat {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.85rem 1rem;
  background: #fff;
}
.stat .num { font-size: 1.6rem; font-weight: 700; }
.badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: #e7efeC;
  font-size: 0.8rem;
}
.badge.published { background: #d7efe6; }
.badge.draft { background: #efe7d7; }
.badge.syncing { background: #e0e8ff; }
.badge.conflict { background: #ffe8d0; }
.badge.error { background: #ffd6d6; }
.preview-frame {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  margin: 0 auto;
  transition: width 0.2s ease;
}
.preview-frame iframe {
  width: 100%;
  height: 640px;
  border: 0;
  background: #fff;
}
button:focus-visible, a:focus-visible { outline: 3px solid #78acf0; outline-offset: 3px; }
.page-heading { display: flex; gap: 1rem; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; }
.page-heading h1 { margin: 0 0 .3rem; font-size: 1.65rem; }
.page-heading p { margin: 0; }
.table-wrap { overflow: auto; }
.empty-state { padding: 3rem 1rem; text-align: center; color: var(--muted); }
.check-label { display: flex; align-items: center; gap: .5rem; }
.check-label input { width: auto; }
@media (max-width: 1000px) {
  .sidebar { width: 180px; top: 114px; }
  main { margin-left: 180px; padding: 1.1rem; }
  .brand { min-width: 145px; }
  .meta { flex-wrap: wrap; }
}
@media (max-width: 700px) {
  .top { position: relative; gap: .8rem; }
  .meta { width: 100%; gap: .6rem; }
  .sidebar { position: relative; width: 100%; top: auto; padding: .5rem; border-bottom: 1px solid var(--line); }
  .sidebar nav { display: flex; flex-wrap: wrap; gap: .25rem; }
  .sidebar nav a { padding: .55rem; font-size: .85rem; }
  .nav-section, .sidebar-note { display: none; }
  main { margin-left: 0; padding: 1rem; }
  .page-heading { align-items: start; flex-wrap: wrap; }
}
.graph-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #faf8f3;
  padding: 0.5rem;
}
</style>

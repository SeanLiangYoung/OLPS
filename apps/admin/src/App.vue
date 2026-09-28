<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  api,
  getAccessToken,
  logoutApi,
  setSelectedDraftId,
} from './api'
import { fetchDraft } from './draft'
import {
  currentUserState,
  selectedDraftIdState,
  selectedDraftNameState,
  setCurrentUser,
} from './workspaceSession'

const route = useRoute()
const router = useRouter()
const showShell = computed(
  () => route.path !== '/login' && route.path !== '/workspace',
)

async function refreshDraftLabel() {
  const id = selectedDraftIdState.value
  if (!id) {
    selectedDraftNameState.value = ''
    return
  }
  try {
    const draft = await fetchDraft(id)
    selectedDraftNameState.value = draft.name
  } catch {
    selectedDraftNameState.value = id.slice(0, 8)
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
  if (!selectedDraftIdState.value && getAccessToken()) {
    const stored = localStorage.getItem('olps_draft_id')
    if (stored) setSelectedDraftId(stored)
  }
  if (showShell.value) {
    await refreshDraftLabel()
    await refreshCurrentUser()
  }
})

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
      <div class="brand">OLPS Admin</div>
      <nav>
        <RouterLink to="/dashboard">总览</RouterLink>
        <RouterLink to="/pages">页面</RouterLink>
        <RouterLink to="/generate">生成</RouterLink>
        <RouterLink to="/publish">发布与同步</RouterLink>
        <RouterLink to="/inquiries">询盘</RouterLink>
        <RouterLink to="/integrations">广告/分析</RouterLink>
        <RouterLink to="/reports">报告</RouterLink>
        <RouterLink to="/settings">设置</RouterLink>
      </nav>
      <div class="meta">
        <span v-if="currentUserState">{{
          currentUserState.name || currentUserState.account
        }}</span>
        <span v-if="selectedDraftIdState">
          草稿 {{ selectedDraftNameState || selectedDraftIdState.slice(0, 8) }}
        </span>
        <button type="button" @click="switchWorkspace">切换工作区</button>
        <button type="button" @click="logout">退出</button>
      </div>
    </header>
    <main :class="{ 'main--auth': !showShell }">
      <RouterView />
    </main>
  </div>
</template>

<style>
:root {
  --bg: #f3efe6;
  --ink: #1c2a32;
  --card: #fffdf8;
  --line: #d7cdc0;
  --accent: #0f6a5a;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", "Noto Sans SC", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(circle at top left, #dceee8, transparent 40%),
    linear-gradient(180deg, #f7f2e8, #ebe4d7);
  min-height: 100vh;
}
a { color: var(--accent); text-decoration: none; }
.app { min-height: 100vh; }
main {
  padding: 1.25rem;
  max-width: 1180px;
  margin: 0 auto;
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
  padding: 0.9rem 1.25rem;
  border-bottom: 1px solid var(--line);
  background: rgba(255,253,248,0.85);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 10;
  flex-wrap: wrap;
}
.brand { font-weight: 700; letter-spacing: 0.02em; }
nav { display: flex; gap: 0.85rem; flex: 1; flex-wrap: wrap; }
nav a.router-link-active { font-weight: 700; }
.meta { display: flex; gap: 0.6rem; align-items: center; font-size: 0.92rem; }
.panel {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 1.1rem 1.2rem;
  margin-bottom: 1rem;
}
button, .btn {
  background: var(--accent);
  color: #fff;
  border: 0;
  border-radius: 999px;
  padding: 0.45rem 0.9rem;
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
.graph-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #faf8f3;
  padding: 0.5rem;
}
</style>

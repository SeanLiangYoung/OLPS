<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { MenuInstance } from 'element-plus'
import { api, ApiError, logoutApi, setSelectedDraftId, getSelectedDraftId } from './api'
import { selectedSiteIdState, selectedSiteNameState, selectedDraftIdState, selectedDraftNameState, currentUserState, setCurrentUser } from './workspaceSession'
import { contentLocale, selectLocale, siteDrafts, selectDraft, type CmsSite, type CmsDraft } from './cms-state'
import { resolveCmsBreadcrumbs } from './cmsBreadcrumbs'
import { buildCmsSidebarMenu, resolveCmsSidebarOpenGroup } from './cmsSidebarMenu'

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

const localeLabel = (code: string): string => {
  if (code === 'en') return 'English'
  if (code === 'zh-CN') return '简体中文'
  if (code === 'zh-TW') return '繁體中文'
  return code
}

const activeMenu = computed(() => {
  const path = route.path
  if (path.startsWith('/collections/')) return path
  if (path.startsWith('/appearance/')) return path
  if (path.startsWith('/settings/')) return path
  if (path.startsWith('/content/')) {
    const collectionId = typeof route.query.collectionId === 'string' ? route.query.collectionId : ''
    if (collectionId) return `/collections/${collectionId}`
    return route.query.ref === 'page' || String(route.params.ref) === 'page' ? '/pages' : '/collections'
  }
  return path
})

const sidebarMenu = computed(() => buildCmsSidebarMenu(collections.value))
const sidebarOpenGroup = computed(() => resolveCmsSidebarOpenGroup(activeMenu.value, sidebarMenu.value))
const sidebarMenuRef = ref<MenuInstance>()
const sidebarDefaultOpeneds = computed(() => (sidebarOpenGroup.value ? [sidebarOpenGroup.value] : []))

watch(sidebarOpenGroup, async (group) => {
  if (!group) return
  await nextTick()
  sidebarMenuRef.value?.open(group)
})

const breadcrumbs = computed(() => {
  const items = resolveCmsBreadcrumbs(route.path).map((item) => ({ ...item }))
  if (route.path.startsWith('/collections/')) {
    const collectionId = String(route.params.collectionId ?? '')
    const collection = collections.value.find((entry) => entry.meta.collectionId === collectionId)
    if (collection && items.length > 0) {
      items[items.length - 1] = { label: collection.locale.title }
    }
  }
  return items
})

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

function changeDraft(draftId: string): void {
  const draft = drafts.value.find(entry => entry.draftId === draftId)
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
    <el-container v-if="showShell" class="cms-shell" direction="vertical">
      <el-header class="cms-topbar" height="64px">
        <div class="cms-topbar-primary">
          <RouterLink class="cms-brand" to="/dashboard">OLPS 网站管理</RouterLink>
          <strong class="cms-site-name">{{ selectedSiteNameState }}</strong>
          <div class="cms-version">
            <span>编辑版本</span>
            <el-select
              :model-value="selectedDraftIdState"
              aria-label="编辑版本"
              style="width: 180px"
              @change="changeDraft"
            >
              <el-option
                v-for="draft in drafts"
                :key="draft.draftId"
                :label="draft.name"
                :value="draft.draftId"
                :disabled="draft.initStatus !== 'ready'"
              />
            </el-select>
          </div>
          <el-button text type="primary" @click="creatingDraft = true">创建编辑版本</el-button>
          <el-select
            :model-value="contentLocale"
            aria-label="内容语言"
            style="width: 140px"
            @change="selectLocale"
          >
            <el-option
              v-for="locale in locales"
              :key="locale.code"
              :label="localeLabel(locale.code)"
              :value="locale.code"
            />
          </el-select>
        </div>
        <div class="cms-topbar-actions">
          <el-button :loading="previewBusy" @click="preview">预览网站</el-button>
          <a
            v-if="site?.status === 'published' && site.publicUrl"
            :href="site.publicUrl"
            target="_blank"
            rel="noopener"
          ><el-button>查看网站</el-button></a>
          <el-button type="primary" @click="router.push('/publish')">发布更改</el-button>
          <span class="cms-user">{{ currentUserState?.name }}</span>
          <el-button text @click="switchSite">切换网站</el-button>
          <el-button text @click="logout">退出</el-button>
        </div>
      </el-header>

      <el-container class="cms-body">
        <el-aside class="cms-sidebar" width="230px">
          <el-scrollbar class="cms-sidebar-scroll">
            <el-menu
              ref="sidebarMenuRef"
              :default-active="activeMenu"
              :default-openeds="sidebarDefaultOpeneds"
              :unique-opened="true"
              router
            >
              <template v-for="entry in sidebarMenu" :key="entry.index">
                <el-menu-item v-if="entry.type === 'item'" :index="entry.index">
                  {{ entry.title }}
                </el-menu-item>
                <el-sub-menu v-else :index="entry.index">
                  <template #title>{{ entry.title }}</template>
                  <el-menu-item
                    v-for="child in entry.children"
                    :key="child.index"
                    :index="child.index"
                  >
                    {{ child.title }}
                  </el-menu-item>
                </el-sub-menu>
              </template>
            </el-menu>
          </el-scrollbar>
        </el-aside>

        <el-main class="cms-main">
          <el-breadcrumb v-if="breadcrumbs.length" class="cms-breadcrumb" separator="/" data-testid="cms-breadcrumb">
            <el-breadcrumb-item v-for="(item, index) in breadcrumbs" :key="`${item.label}-${index}`">
              <RouterLink v-if="item.to" :to="item.to">{{ item.label }}</RouterLink>
              <span v-else>{{ item.label }}</span>
            </el-breadcrumb-item>
          </el-breadcrumb>
          <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="cms-page-alert" />
          <RouterView :key="selectedSiteIdState" />
        </el-main>
      </el-container>
    </el-container>

    <RouterView v-else :key="selectedSiteIdState" />

    <el-dialog v-model="creatingDraft" title="创建编辑版本" width="520px">
      <p class="cms-dialog-lede">已经发布的网站使用当前公开版本；尚未发布的网站使用已保存的初始版本。</p>
      <el-form label-position="top" @submit.prevent="createDraft">
        <el-form-item label="版本名称">
          <el-input v-model="draftName" maxlength="200" required />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="draftBusy" @click="createDraft">确认创建</el-button>
          <el-button :disabled="draftBusy" @click="creatingDraft = false">取消</el-button>
        </el-form-item>
      </el-form>
    </el-dialog>
  </div>
</template>

<style>
:root {
  font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-page);
  --line: var(--el-border-color);
  --accent: var(--el-color-primary);
  --muted: var(--el-text-color-secondary);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--el-bg-color-page); color: var(--el-text-color-primary); }
a { color: var(--el-color-primary); }
h1 { font-size: 28px; margin-top: 0; }
h2 { font-size: 20px; }
h3 { font-size: 17px; }
p { line-height: 1.65; }
.panel {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  padding: 24px;
  margin-bottom: 22px;
  box-shadow: var(--el-box-shadow-lighter);
}
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.error {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  padding: 12px;
  border-radius: var(--el-border-radius-base);
}
.ok { color: var(--el-color-success); }
.muted { color: var(--el-text-color-secondary); }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td {
  padding: 14px;
  text-align: left;
  border-bottom: 1px solid var(--el-border-color-lighter);
  vertical-align: middle;
}
.table th { font-size: 13px; color: var(--el-text-color-secondary); }
.badge {
  font-size: 12px;
  padding: 4px 9px;
  border-radius: 12px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.cms-shell { min-height: 100vh; }
.cms-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 20px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  position: sticky;
  top: 0;
  z-index: 20;
}
.cms-topbar-primary, .cms-topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.cms-topbar-actions { margin-left: auto; }
.cms-brand {
  font-weight: 700;
  color: var(--el-color-primary);
  text-decoration: none;
}
.cms-site-name { font-size: 15px; }
.cms-user { color: var(--el-text-color-secondary); font-size: 14px; }
.cms-version {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.cms-body { min-height: calc(100vh - 64px); }
.cms-sidebar {
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color);
  padding: 12px 0;
  min-height: calc(100vh - 64px);
  height: calc(100vh - 64px);
  overflow: hidden;
}
.cms-sidebar-scroll {
  flex: 1;
  min-height: 0;
}
.cms-sidebar .el-menu { border-right: none; }
.cms-main {
  padding: 24px 30px;
  min-width: 0;
  max-width: 1600px;
  background: var(--el-bg-color-page);
}
.cms-breadcrumb {
  margin-bottom: 16px;
  font-size: 14px;
}
.cms-page-alert { margin-bottom: 16px; }
.cms-dialog-lede { margin: 0 0 16px; color: var(--el-text-color-regular); }
summary { cursor: pointer; font-weight: 600; }
details { margin: 14px 0; }
@media (max-width: 960px) {
  .cms-main { padding: 20px; }
  .cms-topbar { position: static; height: auto !important; padding: 12px 16px; }
}
@media (max-width: 680px) {
  .cms-body { flex-direction: column; }
  .cms-sidebar { width: 100% !important; min-height: 0; border-right: none; border-bottom: 1px solid var(--el-border-color); }
  .cms-main { padding: 16px; }
  .cms-topbar-actions { width: 100%; margin-left: 0; }
}
</style>

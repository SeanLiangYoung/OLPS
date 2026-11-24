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
    <header>
      <h1>我的网站</h1>
      <p>选择要管理的网站，或者创建一个新网站。</p>
    </header>

    <el-alert
      v-if="error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
      class="sites-alert"
    />

    <el-card shadow="never" class="sites-create">
      <template #header>
        <span>创建网站</span>
      </template>
      <el-form inline @submit.prevent="create">
        <el-form-item label="网站名称">
          <el-input
            v-model="name"
            maxlength="200"
            placeholder="例如：我的公司网站"
            style="width: 280px"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            native-type="submit"
            :loading="creating"
            :disabled="creating || !!preparing || !name.trim()"
          >
            {{ creating ? '正在创建…' : '创建网站' }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-if="preparing" shadow="never" class="sites-preparing" aria-live="polite">
      <template #header>
        <span>{{ preparing.site.name }}</span>
      </template>
      <el-alert
        v-if="preparing.failed"
        title="网站准备失败，请重试。"
        type="error"
        show-icon
        :closable="false"
      />
      <el-text v-else>正在准备页面、主题和网站功能…</el-text>
      <div class="sites-preparing-actions">
        <el-button v-if="preparing.failed" type="primary" @click="retry">重新准备网站</el-button>
        <el-button @click="cancelPreparation">返回网站列表</el-button>
      </div>
    </el-card>

    <section class="cms-site-grid" aria-label="网站列表">
      <el-card v-for="site in sites" :key="site.siteId" shadow="hover" class="site-card">
        <h2>{{ site.name }}</h2>
        <el-tag :type="site.status === 'published' ? 'success' : 'info'" size="small">
          {{ site.status === 'published' ? '已经发布' : '尚未发布' }}
        </el-tag>
        <div class="site-card-actions">
          <el-button type="primary" @click="enter(site)">进入网站</el-button>
          <a
            v-if="site.publicUrl && site.status === 'published'"
            :href="site.publicUrl"
            target="_blank"
            rel="noopener"
          >
            <el-button>查看网站</el-button>
          </a>
        </div>
      </el-card>
      <el-empty v-if="!sites.length" description="尚未创建网站。" />
    </section>
  </main>
</template>

<style scoped>
.cms-sites {
  max-width: 1120px;
  margin: 48px auto;
  padding: 0 24px;
}

.sites-alert {
  margin-bottom: 20px;
}

.sites-create,
.sites-preparing {
  margin-bottom: 20px;
}

.sites-preparing-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.cms-site-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
}

.site-card h2 {
  margin: 0 0 12px;
  font-size: 1.125rem;
}

.site-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}
</style>

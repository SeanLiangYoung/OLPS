<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { setSelectedDraftId } from '../api'
import { createDraft, listDrafts, listPublishedSites } from '../draft'
import { draftStatusLabel, formatCommitRef } from '../draftDisplay'
import OwnersPanel from '../components/OwnersPanel.vue'
import type { PublishedSite, SiteDraft } from '../types'

const router = useRouter()
const sites = ref<PublishedSite[]>([])
const drafts = ref<SiteDraft[]>([])
const error = ref('')
const loading = ref(true)
const newDraftName = ref('')
const createFromSiteId = ref('')
const ownersDraftId = ref('')
const ownersSiteId = ref('')
const busy = ref(false)

async function reload() {
  loading.value = true
  error.value = ''
  try {
    const [siteList, draftList] = await Promise.all([
      listPublishedSites(),
      listDrafts(),
    ])
    sites.value = siteList
    drafts.value = draftList
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(reload)

function openDraft(draft: SiteDraft) {
  setSelectedDraftId(draft.draftId)
  router.push('/dashboard')
}

async function submitNewDraft() {
  const name = newDraftName.value.trim()
  if (!name) {
    error.value = '请填写草稿名称'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const body: { name: string; siteId?: string } = { name }
    if (createFromSiteId.value) body.siteId = createFromSiteId.value
    const draft = await createDraft(body)
    newDraftName.value = ''
    createFromSiteId.value = ''
    await reload()
    openDraft(draft)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="workspace-page">
    <section class="workspace-card">
      <header class="workspace-brand">
        <span class="workspace-mark" aria-hidden="true">O</span>
        <h1>选择工作草稿</h1>
        <p class="workspace-lede">
          已发布网站仅用于线上访问与询盘统计；编辑与生成请在 sandbox 草稿中进行。
        </p>
      </header>

      <p v-if="loading" class="muted">加载中…</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <section v-if="!loading" class="panel" style="background: #fff;">
        <h2 style="margin-top: 0;">我的草稿</h2>
        <ul v-if="drafts.length" class="workspace-list">
          <li v-for="draft in drafts" :key="draft.draftId">
            <button class="workspace-item" type="button" @click="openDraft(draft)">
              <span class="workspace-name">{{ draft.name }}</span>
              <span class="workspace-meta">
                <span class="badge" :class="draft.status">{{ draftStatusLabel(draft.status) }}</span>
                <span v-if="draft.siteId">关联网站 {{ draft.siteId.slice(0, 8) }}</span>
                <span>版本 {{ formatCommitRef(draft.headCommitId) }}</span>
              </span>
              <span v-if="draft.conflictMessage" class="error" style="font-size: 0.85rem;">
                {{ draft.conflictMessage }}
              </span>
              <span v-if="draft.lastError" class="error" style="font-size: 0.85rem;">
                {{ draft.lastError }}
              </span>
            </button>
            <button
              type="button"
              class="ghost"
              style="margin-top: 0.35rem;"
              @click="ownersDraftId = ownersDraftId === draft.draftId ? '' : draft.draftId"
            >
              {{ ownersDraftId === draft.draftId ? '收起所有者' : '管理草稿所有者' }}
            </button>
            <OwnersPanel
              v-if="ownersDraftId === draft.draftId"
              scope="draft"
              :resource-id="draft.draftId"
            />
          </li>
        </ul>
        <p v-else class="muted">尚无草稿，请新建。</p>
      </section>

      <section v-if="!loading" class="panel" style="background: #fff;">
        <h2 style="margin-top: 0;">新建草稿</h2>
        <div class="grid">
          <label>
            名称
            <input v-model="newDraftName" placeholder="例如：春季活动站" />
          </label>
          <label>
            基于已发布网站（可选）
            <select v-model="createFromSiteId">
              <option value="">独立新站草稿</option>
              <option v-for="s in sites" :key="s.siteId" :value="s.siteId">
                {{ s.name }}
              </option>
            </select>
          </label>
          <button type="button" :disabled="busy" @click="submitNewDraft">创建草稿</button>
        </div>
      </section>

      <section v-if="!loading && sites.length" class="panel" style="background: #fff;">
        <h2 style="margin-top: 0;">已发布网站</h2>
        <ul class="workspace-list">
          <li v-for="site in sites" :key="site.siteId">
            <div class="workspace-item" style="cursor: default;">
              <span class="workspace-name">{{ site.name }}</span>
              <span class="workspace-meta">
                <span v-if="site.publicUrl">
                  <a :href="site.publicUrl" target="_blank" rel="noopener">{{ site.publicUrl }}</a>
                </span>
                <span>发布版本 {{ formatCommitRef(site.publishedCommitId) }}</span>
              </span>
            </div>
            <button
              type="button"
              class="ghost"
              style="margin-top: 0.35rem;"
              @click="ownersSiteId = ownersSiteId === site.siteId ? '' : site.siteId"
            >
              {{ ownersSiteId === site.siteId ? '收起所有者' : '管理网站所有者' }}
            </button>
            <OwnersPanel
              v-if="ownersSiteId === site.siteId"
              scope="site"
              :resource-id="site.siteId"
            />
          </li>
        </ul>
      </section>
    </section>
  </main>
</template>

<style scoped>
.workspace-page {
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 2rem 1rem;
  place-items: start center;
}

.workspace-card {
  width: min(100%, 42rem);
  display: grid;
  gap: 1rem;
}

.workspace-brand {
  text-align: center;
  margin-bottom: 0.5rem;
}

.workspace-mark {
  display: inline-grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border-radius: 0.85rem;
  background: linear-gradient(135deg, #0f6a5a, #1a8f7a);
  color: #fff;
  font-weight: 700;
}

h1 {
  margin: 0.5rem 0 0;
  font-size: 1.5rem;
}

.workspace-lede {
  margin: 0.35rem 0 0;
  color: #5b6b73;
  font-size: 0.9rem;
}

.workspace-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 1rem;
}

.workspace-item {
  display: grid;
  gap: 0.35rem;
  width: 100%;
  text-align: left;
  padding: 0.85rem 1rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #faf8f3;
  cursor: pointer;
  font: inherit;
}

.workspace-name {
  font-weight: 600;
}

.workspace-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #5b6b73;
}
</style>

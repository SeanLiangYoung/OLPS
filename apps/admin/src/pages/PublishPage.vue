<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, getTenantId } from '../api'
import { ensureSite } from '../site'
import type { PageRecord } from '../types'

const siteId = ref('')
const pages = ref<PageRecord[]>([])
const sitemapUrl = ref('')
const error = ref('')

function publicUrls(page: PageRecord): string[] {
  if (page.publicUrls?.length) return page.publicUrls
  const tenantId = getTenantId()
  if (page.kind === 'ads' && page.body?.ads?.keywordCluster?.length) {
    return page.body.ads.keywordCluster.map((kw) => {
      const slug = `${page.slug}--${kw.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
      return `/p/${tenantId}/${siteId.value}/${slug}/`
    })
  }
  return [`/p/${tenantId}/${siteId.value}/${page.slug}/`]
}

onMounted(async () => {
  try {
    const site = await ensureSite()
    siteId.value = site.siteId
    const data = await api<{ pages: PageRecord[] }>(
      'GET',
      `/api/sites/${site.siteId}/pages?status=published`,
    )
    pages.value = data.pages ?? []
    const dash = await api<{ sitemapUrl?: string }>('GET', '/api/dashboard').catch(() => null)
    if (dash?.sitemapUrl) {
      sitemapUrl.value = dash.sitemapUrl
    } else {
      sitemapUrl.value = `/p/${getTenantId()}/${site.siteId}/sitemap.xml`
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})
</script>

<template>
  <section class="panel">
    <h1>发布中心</h1>
    <p class="muted">当前已发布页面与公开 URL。</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="panel" style="background:#fff;margin:0 0 1rem;">
      <h2 style="margin-top:0;">Sitemap</h2>
      <a v-if="sitemapUrl" :href="sitemapUrl" target="_blank" rel="noopener">{{ sitemapUrl }}</a>
      <p v-else class="muted">暂无 sitemap。</p>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>类型</th>
          <th>标题</th>
          <th>slug</th>
          <th>公开 URL</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in pages" :key="p.pageId">
          <td>{{ p.kind }}</td>
          <td>{{ p.title }}</td>
          <td>{{ p.slug }}</td>
          <td>
            <div v-for="u in publicUrls(p)" :key="u">
              <a :href="u" target="_blank" rel="noopener">{{ u }}</a>
            </div>
          </td>
          <td><RouterLink :to="`/pages/${p.pageId}`">编辑</RouterLink></td>
        </tr>
      </tbody>
    </table>
    <p v-if="!pages.length" class="muted">暂无已发布页面。</p>
  </section>
</template>

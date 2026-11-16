<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { listProposalRegions, mergeProposalRegions } from '../rewriteProposal'
import { HtmlDocument } from '../editor/document'
import type { PageRecord } from '../types'

const props = defineProps<{ draftId: string; source: PageRecord; proposal: PageRecord; expectedUpdatedAt: string }>()
const emit = defineEmits<{ adopted: [pageId: string] }>()
const selected = ref<string[]>([])
const busy = ref(false)
const error = ref('')
const resources = ref<Array<{ url: string; previewUrl: string }>>([])
onMounted(async () => {
  try { resources.value = (await api<{ resources: Array<{ url: string; previewUrl: string }> }>('GET', `/api/drafts/${props.draftId}/editor-resources`)).resources }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
})
const regions = computed(() => props.proposal.body.ads ? [] : listProposalRegions(props.source.body.html, props.proposal.body.html))
const beforeHtml = computed(() => new HtmlDocument(props.source.body.html).canvasHtml(resources.value))
const afterHtml = computed(() => new HtmlDocument(props.proposal.body.html).canvasHtml(resources.value))
const screenChanges = computed(() => {
  const before = props.source.body.ads
  const after = props.proposal.body.ads
  const ids = new Set([...(before?.screens || []).map(screen => screen.screenId), ...(after?.screens || []).map(screen => screen.screenId)])
  return [...ids].map(id => ({ id, before: before?.screens.find(screen => screen.screenId === id), after: after?.screens.find(screen => screen.screenId === id), beforeGuide: before?.guide.nodes[id]?.options || [], afterGuide: after?.guide.nodes[id]?.options || [] }))
})
function screenPreview(html?: string): string { return new HtmlDocument(html || '<p>没有此内容屏幕</p>').canvasHtml(resources.value) }
async function adopt(partial: boolean) {
  busy.value = true; error.value = ''
  try {
    const html = partial ? mergeProposalRegions(props.source.body.html, props.proposal.body.html, selected.value) : props.proposal.body.html
    const result = await api<{ page: PageRecord }>('PATCH', `/api/drafts/${props.draftId}/pages/${props.source.pageId}/editor`, {
      body: partial ? { ...props.source.body, html } : props.proposal.body,
      expectedUpdatedAt: props.expectedUpdatedAt,
      metadata: props.proposal.metadata,
      ...(partial ? {} : { title: props.proposal.title, slug: props.proposal.slug, seo: props.proposal.seo }),
    })
    emit('adopted', result.page.pageId)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
</script>

<template>
  <section class="panel" aria-label="审阅改写结果"><h2>审阅改写结果</h2><p>当前页面保持原内容。确认采用后保存，公开展示需要另外发布。</p><p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="screenChanges.length"><h3>广告关键词与引导入口</h3><div class="proposal-previews"><pre>{{ source.body.ads?.guide.entryByKeyword }}</pre><pre>{{ proposal.body.ads?.guide.entryByKeyword }}</pre></div><section v-for="screen in screenChanges" :key="screen.id" class="screen-review"><h3>{{ screen.before?.title || screen.after?.title }} · {{ screen.id }}</h3><div class="proposal-previews"><div><h4>当前内容</h4><iframe :srcdoc="screenPreview(screen.before?.html)" sandbox="" :title="`当前屏幕 ${screen.id}`" /><ul><li v-for="option in screen.beforeGuide" :key="option.id">{{ option.label }} → {{ option.action === 'go_cta' ? '询盘表单' : option.targetScreenId || option.pageId }}</li></ul></div><div><h4>建议内容</h4><iframe :srcdoc="screenPreview(screen.after?.html)" sandbox="" :title="`建议屏幕 ${screen.id}`" /><ul><li v-for="option in screen.afterGuide" :key="option.id">{{ option.label }} → {{ option.action === 'go_cta' ? '询盘表单' : option.targetScreenId || option.pageId }}</li></ul></div></div></section></template>
    <div v-else class="proposal-previews"><div><h3>当前内容</h3><iframe :srcdoc="beforeHtml" sandbox="" title="改写前内容" /></div><div><h3>建议内容</h3><iframe :srcdoc="afterHtml" sandbox="" title="改写建议内容" /></div></div><div v-if="regions.length"><h3>选择需要采用的内容区域</h3><label v-for="region in regions" :key="region.key" class="proposal-region"><input v-model="selected" type="checkbox" :value="region.key" /><span><strong>{{ region.before }}</strong><br />{{ region.after }}</span></label><button type="button" :disabled="busy || !selected.length" @click="adopt(true)">采用所选区域并保存</button></div><p v-else class="muted">内容结构、共用样式或引导关系需要整体审阅，可以整体采用后继续编辑。</p><div class="row"><button type="button" :disabled="busy" @click="adopt(false)">{{ busy ? '正在保存…' : '整体采用并保存' }}</button><RouterLink :to="`/drafts/${draftId}/pages/${source.pageId}`">保留当前内容</RouterLink></div></section>
</template>

<style scoped>
.proposal-previews { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }.proposal-previews iframe { width: 100%; height: 400px; border: 1px solid var(--line); background: white; }.proposal-region { display: flex; align-items: start; gap: .7rem; padding: .7rem; border: 1px solid var(--line); border-radius: 8px; }.proposal-region input { width: auto; margin-top: .25rem; }.row { margin-top: 1rem; }@media(max-width:800px){.proposal-previews{grid-template-columns:1fr;}}
</style>

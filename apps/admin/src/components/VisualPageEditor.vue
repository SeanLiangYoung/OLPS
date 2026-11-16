<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import grapesjs, { type Editor, type Component } from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'
import { api, getAccessToken } from '../api'
import type { AdsPayload } from '../types'
import { HtmlDocument } from '../editor/document'
import { buildExperienceHtml } from '../editor/experience'
import { validateGuideGraph, type AdsPayload as DomainAdsPayload } from '@olps/domain'
import { setElementStyle, elementStyleValues, type StyleScope } from '../editor/styles'
import { duplicateRegion, removeRegion, updateGuideLabel as setGuideLabel } from '../editor/guide-operations'
import type { PreviewResource } from '../editor/resource-preview'
import { validatedAttribute } from '../editor/attributes'

const props = defineProps<{ html: string; draftId: string; ads?: AdsPayload; screenId?: string; screenCap?: number; pages?: { pageId: string; title: string; slug: string; locale?: string; publicUrls?: string[] }[] }>()
const emit = defineEmits<{ 'update:html': [html: string]; 'update:ads': [ads: AdsPayload]; dirty: [dirty: boolean] }>()
type Asset = { assetId: string; url: string; previewUrl: string; name: string; width: number; height: number; mimeType: string }
const container = ref<HTMLElement>()
const selectedKey = ref('')
const revision = ref(0)
const error = ref('')
const busy = ref(false)
const mode = ref<'edit' | 'experience'>('edit')
const device = ref<'desktop' | 'tablet' | 'mobile'>('desktop')
const styleScope = ref<'all' | 'current'>('all')
const selectedStyleScope = computed<StyleScope>(() => styleScope.value === 'all' ? 'all' : device.value)
const assets = ref<Asset[]>([])
const resources = ref<PreviewResource[]>([])
const previewResources = computed(() => [...resources.value.filter(resource => !assets.value.some(asset => asset.url === resource.url)), ...assets.value])
const advanced = ref(false)
const advancedHtml = ref('')
const selectedGuideId = ref('')
const text = ref('')
const href = ref('')
const alt = ref('')
const source = ref('')
const styleValues = ref<Record<string, string>>({})
const imagePurpose = ref<'image' | 'background'>('image')
const pendingRemoval = ref('')
const removalImpact = ref('')
const replacementId = ref('')
const targetSearch = ref('')
const previewScreenId = ref('')
const attributeName = ref('title')
const attributeValue = ref('')
const filteredScreens = computed(() => props.ads?.screens.filter(item => item.role !== 'cta' && `${item.title} ${item.screenId}`.toLocaleLowerCase().includes(targetSearch.value.toLocaleLowerCase())) || [])
const filteredPages = computed(() => props.pages?.filter(item => `${item.title} ${item.slug}`.toLocaleLowerCase().includes(targetSearch.value.toLocaleLowerCase())) || [])
let model = new HtmlDocument(props.html)
let editor: Editor | undefined
let rendering = false
let cursor = 0
let draggedKey = ''
let pointerSelectionKey = ''
let canvasObserver: ResizeObserver | undefined
const history = ref<{ html: string; ads?: AdsPayload }[]>([{ html: props.html, ads: props.ads ? structuredClone(JSON.parse(JSON.stringify(props.ads))) : undefined }])
const nodes = computed(() => { revision.value; return model.nodes.filter(node => !['style', 'script', 'meta', 'link', 'source'].includes(node.tag)) })
const selected = computed(() => { revision.value; return model.nodes.find(node => node.key === selectedKey.value) })
const breadcrumbs = computed(() => {
  const result = []
  let current = selected.value
  while (current) { result.unshift(current); current = model.nodes.find(node => node.key === current?.parent) }
  return result
})
const selectedElement = computed(() => {
  if (!selected.value) return undefined
  const template = document.createElement('template')
  template.innerHTML = model.source(selected.value.key)
  return template.content.firstElementChild as HTMLElement | null
})
const optionId = computed(() => {
  if (selectedGuideId.value) return selectedGuideId.value
  let node = selected.value
  while (node) {
    const id = node.element.attrs.find(attribute => ['data-guide-option', 'data-olps-guide-option'].includes(attribute.name))?.value
    if (id) return id
    node = node.parent ? model.nodes.find(item => item.key === node!.parent) : undefined
  }
  return ''
})
const guideOption = computed(() => props.ads?.guide.nodes[props.screenId || '']?.options.find(option => option.id === optionId.value))
const guideIssues = computed(() => props.ads ? validateGuideGraph(props.ads as DomainAdsPayload, { screenCap: props.screenCap ?? 20 }).issues : [])
const experience = computed(() => {
  revision.value
  return buildExperienceHtml({ html: model.html, ads: props.ads, screenId: previewScreenId.value || props.screenId, assets: previewResources.value })
})
const styleLabels: Record<string, string> = { color: '文字颜色', 'background-color': '背景颜色', 'font-family': '字体', 'font-size': '字号', 'font-weight': '字体粗细', 'text-align': '文字排列', padding: '内部间距', margin: '外部间距', width: '显示宽度', height: '显示高度', 'max-width': '最大宽度', display: '排列方式', gap: '内容间距', border: '边框', 'border-radius': '圆角', 'object-fit': '图片裁剪', 'aspect-ratio': '显示比例' }

function selection(key: string) {
  selectedGuideId.value = ''
  selectedKey.value = key
  const element = selectedElement.value
  if (!element) return
  text.value = element.textContent || ''
  href.value = element.getAttribute('href') || ''
  alt.value = element.getAttribute('alt') || ''
  source.value = element.getAttribute('src') || ''
  imagePurpose.value = selected.value?.tag === 'img' ? 'image' : 'background'
  const values: Record<string, string> = {}
  const storedStyles = elementStyleValues(model.html, key, selectedStyleScope.value)
  for (const property of ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'text-align', 'padding', 'margin', 'width', 'height', 'max-width', 'display', 'gap', 'border', 'border-radius', 'object-fit', 'aspect-ratio']) values[property] = storedStyles[property] || ''
  styleValues.value = values
  const component = editor?.getWrapper()?.find(`[data-editor-node="${key}"]`)[0]
  if (component && editor?.getSelected() !== component) editor?.select(component)
}

function closeProperties() {
  selectedKey.value = ''
  selectedGuideId.value = ''
  editor?.select(undefined)
}

function render() {
  const key = selectedKey.value
  rendering = true
  model = new HtmlDocument(model.html)
  revision.value += 1
  editor?.setStyle('')
  editor?.setComponents(model.canvasHtml(previewResources.value))
  editor?.getWrapper()?.onAll(component => component.set({ editable: false, draggable: false, removable: false, copyable: false }))
  const frameDocument = editor?.Canvas.getDocument()
  if (frameDocument) bindCanvasDocument(frameDocument)
  rendering = false
  if (model.nodes.some(node => node.key === key)) selection(key)
  else selectedKey.value = ''
}

function commit(change: () => void, ads?: AdsPayload) {
  error.value = ''
  try {
    change()
    const nextAds = ads || (props.ads ? JSON.parse(JSON.stringify(props.ads)) as AdsPayload : undefined)
    const screen = nextAds?.screens.find(item => item.screenId === props.screenId)
    if (screen) screen.html = model.html
    const snapshot = { html: model.html, ads: nextAds }
    history.value = [...history.value.slice(0, cursor + 1), snapshot]
    cursor += 1
    emit('update:html', model.html)
    if (nextAds) emit('update:ads', nextAds)
    emit('dirty', true)
    render()
  } catch (exception) { error.value = exception instanceof Error ? exception.message : String(exception) }
}

function undo(direction: number) {
  const snapshot = history.value[cursor + direction]
  if (!snapshot) return
  cursor += direction
  model = new HtmlDocument(snapshot.html)
  emit('update:html', model.html)
  if (snapshot.ads) emit('update:ads', JSON.parse(JSON.stringify(snapshot.ads)))
  emit('dirty', true)
  render()
}

function updateText() {
  const ads = props.ads ? JSON.parse(JSON.stringify(props.ads)) as AdsPayload : undefined
  const option = ads?.guide.nodes[props.screenId || '']?.options.find(item => item.id === optionId.value)
  if (option && props.ads) {
    const result = setGuideLabel(model.html, props.ads, props.screenId || '', option.id, text.value)
    commit(() => { model.html = result.html }, result.ads)
    return
  }
  commit(() => model.text(selectedKey.value, text.value), ads)
}

function updateGuideLabel(value: string) {
  const result = setGuideLabel(model.html, props.ads!, props.screenId || '', optionId.value, value)
  commit(() => { model.html = result.html }, result.ads)
}

function duplicateSelected() {
  try {
    const result = duplicateRegion(model.html, selectedKey.value, props.ads, props.screenId)
    commit(() => { model.html = result.html }, result.ads)
  } catch (exception) { error.value = exception instanceof Error ? exception.message : String(exception) }
}

function moveSelected(direction: number) {
  const node = model.node(selectedKey.value)
  const siblings = model.nodes.filter(item => item.parent === node.parent)
  const index = siblings.findIndex(item => item.key === node.key)
  if (!siblings[index + direction]) return
  commit(() => {
    model.move(node.key, direction)
    model = new HtmlDocument(model.html)
    selectedKey.value = model.nodes.filter(item => item.parent === node.parent)[index + direction]!.key
  })
}

function updateStyle(property: string, value: string) {
  commit(() => { model.html = setElementStyle(model.html, selectedKey.value, property, value, selectedStyleScope.value).html })
}

function choosePage(pageId: string) {
  const page = props.pages?.find(item => item.pageId === pageId)
  if (!page) return
  commit(() => model.link(selectedKey.value, page.publicUrls?.[0] || `/${page.slug}/`, page.pageId))
}

function requestRemoval() {
  error.value = ''
  try { model.protect(selectedKey.value); commit(() => model.remove(selectedKey.value)) }
  catch (exception) {
    pendingRemoval.value = selectedKey.value
    removalImpact.value = exception instanceof Error ? exception.message : String(exception)
    replacementId.value = ''
  }
}

function confirmRemoval() {
  const key = pendingRemoval.value
  try {
    const result = removeRegion(model.html, key, props.ads, props.screenId, { confirmSystem: true, replacementId: replacementId.value || undefined })
    commit(() => { model.html = result.html }, result.ads)
    pendingRemoval.value = ''
  } catch (exception) { error.value = exception instanceof Error ? exception.message : String(exception) }
}

function replaceImage(url: string, key = selectedKey.value) {
  if (imagePurpose.value === 'background') {
    commit(() => { model.html = setElementStyle(model.html, key, 'background-image', `url("${url}")`, selectedStyleScope.value).html })
  } else commit(() => model.image(key, url))
}

function setGuideTarget(value: string) {
  if (!props.ads || !guideOption.value) return
  const ads = JSON.parse(JSON.stringify(props.ads)) as AdsPayload
  const option = ads.guide.nodes[props.screenId || '']!.options.find(item => item.id === optionId.value)!
  delete option.targetScreenId
  delete option.pageId
  if (value === 'CTA') option.action = 'go_cta'
  else if (value.startsWith('page:')) { option.action = 'link_page'; option.pageId = value.slice(5) }
  else { option.action = 'navigate'; option.targetScreenId = value }
  commit(() => {}, ads)
}

function previewGuideTarget() {
  if (!props.ads || !guideOption.value) return
  previewScreenId.value = guideOption.value.action === 'go_cta' ? props.ads.screens.find(screen => screen.role === 'cta')!.screenId : guideOption.value.targetScreenId || ''
  mode.value = 'experience'
}

async function loadAssets() {
  const [result, resourceResult] = await Promise.all([
    api<{ assets: Asset[] }>('GET', `/api/drafts/${encodeURIComponent(props.draftId)}/assets`),
    api<{ resources: PreviewResource[] }>('GET', `/api/drafts/${encodeURIComponent(props.draftId)}/editor-resources`),
  ])
  assets.value = result.assets
  resources.value = resourceResult.resources
}

async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 10 * 1024 * 1024) { error.value = '图片不能超过 10 MiB'; return }
  const key = selectedKey.value
  const before = model.html
  busy.value = true
  error.value = ''
  try {
    const form = new FormData()
    form.append('file', file)
    const response = await fetch(`/api/drafts/${encodeURIComponent(props.draftId)}/assets`, { method: 'POST', headers: { authorization: `Bearer ${getAccessToken()}` }, body: form })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '图片上传失败')
    assets.value.push(data.asset)
    if (before !== model.html || key !== selectedKey.value) throw new Error('图片已上传到图库，请重新选择需要替换的图片')
    replaceImage(data.asset.url, key)
  } catch (exception) { error.value = exception instanceof Error ? exception.message : String(exception) }
  finally { busy.value = false }
}

const templates: Record<string, string> = {
  标题介绍: '<section><h2>请输入标题</h2><p>请输入介绍内容。</p></section>',
  图文内容: '<section><h2>图文内容</h2><img alt="请上传图片"><p>请输入内容说明。</p></section>',
  产品展示: '<section><h2>产品展示</h2><article><h3>请输入产品名称</h3><p>请输入产品说明。</p></article></section>',
  客户案例: '<section><h2>客户案例</h2><p>请输入获得授权的客户案例。</p></section>',
  常见问题: '<section><h2>常见问题</h2><details><summary>请输入问题</summary><p>请输入回答。</p></details></section>',
  询盘表单: '<section><h2>联系我们</h2><form data-olps-inquiry><label>姓名<input name="name" required></label><label>邮箱<input name="email" type="email" required></label><label>需求<textarea name="message" required></textarea></label><button type="submit">发送询盘</button><p data-olps-inquiry-status role="status"></p></form></section>',
}

function drop(key: string) {
  if (!draggedKey || draggedKey === key) return
  const from = model.node(draggedKey)
  const target = model.node(key)
  if (from.parent !== target.parent) { error.value = '请在相同父级区域之间调整顺序'; return }
  const direction = Number(from.key) < Number(target.key) ? 1 : -1
  let remaining = Math.abs(model.nodes.filter(item => item.parent === from.parent).findIndex(item => item.key === target.key) - model.nodes.filter(item => item.parent === from.parent).findIndex(item => item.key === from.key))
  commit(() => {
    let currentKey = draggedKey
    while (remaining-- > 0) {
      const siblings = model.nodes.filter(item => item.parent === model.node(currentKey).parent)
      const index = siblings.findIndex(item => item.key === currentKey)
      model.move(currentKey, direction)
      model = new HtmlDocument(model.html)
      currentKey = model.nodes.filter(item => item.parent === from.parent)[index + direction]!.key
    }
  })
  draggedKey = ''
}

function handleCanvasMouseDown(event: MouseEvent) {
  pointerSelectionKey = (event.target as Element).closest('[data-editor-node]')?.getAttribute('data-editor-node') || ''
  if (pointerSelectionKey) selection(pointerSelectionKey)
}

function handleCanvasClick(event: MouseEvent) {
  event.preventDefault()
  const element = (event.target as Element).closest('[data-editor-node]')
  const key = pointerSelectionKey || element?.getAttribute('data-editor-node')
  pointerSelectionKey = ''
  if (key) selection(key)
  else closeProperties()
}

function handleCanvasSubmit(event: Event) { event.preventDefault(); event.stopImmediatePropagation() }

function handleCanvasDoubleClick(event: MouseEvent) {
  const element = (event.target as Element).closest('[data-editor-node]') as HTMLElement | null
  const key = element?.getAttribute('data-editor-node')
  if (!element || !key) return
  const node = model.nodes.find(item => item.key === key)
  if (!node || node.element.childNodes.some(child => 'tagName' in child) || ['img', 'input', 'br', 'hr', 'script', 'style'].includes(node.tag)) return
  element.contentEditable = 'true'
  element.focus()
  element.addEventListener('blur', () => {
    element.contentEditable = 'false'
    if (element.textContent !== node.element.childNodes.map(child => 'value' in child ? child.value : '').join('')) {
      selection(key)
      text.value = element.textContent || ''
      updateText()
    }
  }, { once: true })
}

function bindCanvasDocument(frameDocument: Document) {
  frameDocument.removeEventListener('keydown', handleKeyboard)
  frameDocument.addEventListener('keydown', handleKeyboard)
  frameDocument.removeEventListener('mousedown', handleCanvasMouseDown, true)
  frameDocument.removeEventListener('click', handleCanvasClick, true)
  frameDocument.removeEventListener('submit', handleCanvasSubmit, true)
  frameDocument.removeEventListener('dblclick', handleCanvasDoubleClick)
  frameDocument.addEventListener('mousedown', handleCanvasMouseDown, true)
  frameDocument.addEventListener('click', handleCanvasClick, true)
  frameDocument.addEventListener('submit', handleCanvasSubmit, true)
  frameDocument.addEventListener('dblclick', handleCanvasDoubleClick)
}

function handleKeyboard(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (mode.value !== 'edit' || target.closest('input,textarea,select,[contenteditable="true"]')) return
  const modifier = event.ctrlKey || event.metaKey
  if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(event.shiftKey ? 1 : -1); return }
  if (!selectedKey.value) return
  if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected() }
  else if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); moveSelected(event.key === 'ArrowUp' ? -1 : 1) }
  else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); requestRemoval() }
}

function applyAttribute() {
  commit(() => model.attributes(selectedKey.value, validatedAttribute(attributeName.value, attributeValue.value)))
}

function fitCanvas() {
  const available = container.value?.clientWidth
  if (!editor || !available) return
  const width = device.value === 'desktop' ? 1100 : device.value === 'tablet' ? 768 : 390
  editor.Canvas.setZoom(Math.min(100, Math.max(10, (available - 24) / width * 100)))
}

onMounted(async () => {
  editor = grapesjs.init({ container: container.value!, height: '650px', storageManager: false, telemetry: false, keymaps: { defaults: {} }, panels: { defaults: [] }, selectorManager: { componentFirst: true }, canvas: { scripts: [], styles: [] }, parser: { optionsHtml: { allowScripts: false, allowUnsafeAttr: false, allowUnsafeAttrValue: false } }, deviceManager: { devices: [{ id: 'desktop', name: '桌面', width: '1100px' }, { id: 'tablet', name: '平板', width: '768px' }, { id: 'mobile', name: '手机', width: '390px' }] } })
  editor.on('component:selected', (component: Component) => {
    const key = component.getAttributes()['data-editor-node']
    if (!rendering && key !== undefined) selection(String(key))
  })
  editor.on('canvas:frame:load:body', ({ window: frameWindow }: { window: Window }) => bindCanvasDocument(frameWindow.document))
  editor.onReady(() => {
    const frameDocument = editor!.Canvas.getDocument()
    if (frameDocument) bindCanvasDocument(frameDocument)
  })
  editor.setDevice(device.value)
  canvasObserver = new ResizeObserver(fitCanvas)
  canvasObserver.observe(container.value!)
  await new Promise<void>(resolve => editor!.onReady(() => resolve()))
  try { await loadAssets() } catch (exception) { error.value = exception instanceof Error ? exception.message : String(exception) }
  render()
  fitCanvas()
})
watch(() => props.html, value => { if (value !== model.html) { model = new HtmlDocument(value); history.value = [{ html: value, ads: props.ads ? JSON.parse(JSON.stringify(props.ads)) : undefined }]; cursor = 0; render() } })
watch(device, value => { editor?.setDevice(value); fitCanvas() })
watch(selectedStyleScope, () => { if (selectedKey.value) selection(selectedKey.value) })
onBeforeUnmount(() => { canvasObserver?.disconnect(); editor?.destroy() })
</script>

<template>
  <section class="visual-editor" aria-label="可视化页面编辑器" @keydown="handleKeyboard">
    <div class="editor-toolbar">
      <button type="button" :disabled="cursor === 0" @click="undo(-1)">撤销</button>
      <button type="button" :disabled="cursor >= history.length - 1" @click="undo(1)">恢复</button>
      <label>设备尺寸<select v-model="device"><option value="desktop">桌面</option><option value="tablet">平板</option><option value="mobile">手机</option></select></label>
      <button type="button" :aria-pressed="mode === 'edit'" @click="mode = 'edit'">编辑模式</button>
      <button type="button" :aria-pressed="mode === 'experience'" @click="previewScreenId = ''; mode = 'experience'">体验模式</button>
      <button type="button" @click="advanced = !advanced; advancedHtml = model.html">高级 HTML</button>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <section v-if="pendingRemoval" role="dialog" aria-label="删除区域确认" class="advanced-html">
      <h3>删除区域的影响</h3><p>{{ removalImpact }}</p>
      <p>删除会移除该区域中的系统组件及对应 Guide 按钮。其他区域的引用需要选择替代目标。</p>
      <label>替代目标<select v-model="replacementId"><option value="">没有外部引用</option><option v-for="node in nodes.filter(node => node.element.attrs.some(attribute => attribute.name === 'id'))" :key="node.key" :value="node.element.attrs.find(attribute => attribute.name === 'id')?.value">{{ node.label }}</option></select></label>
      <button type="button" @click="confirmRemoval">确认删除区域</button><button type="button" @click="pendingRemoval = ''">保留区域</button>
    </section>
    <section v-if="advanced" class="advanced-html">
      <label>HTML 正文<textarea v-model="advancedHtml" rows="14" /></label>
      <button type="button" @click="commit(() => { model = new HtmlDocument(advancedHtml) }); advanced = false">应用 HTML</button>
      <p>系统组件标识、Guide 按钮标识及元素引用需要保持有效。脚本仅保存在正文中。</p>
    </section>
    <div v-show="mode === 'edit'" class="editor-columns" :class="{ 'has-properties': selected || guideOption }">
      <aside class="editor-outline" aria-label="内容目录">
        <h3>内容目录</h3>
        <p>快捷键：Ctrl/⌘ + D 复制，Alt + ↑/↓ 排序，Delete 删除，Ctrl/⌘ + Z 撤销，Ctrl/⌘ + Shift + Z 恢复。</p>
        <button v-for="node in nodes" :key="node.key" type="button" draggable="true" :aria-pressed="selectedKey === node.key" :style="{ paddingLeft: `${12 + node.depth * 12}px` }" @click="selection(node.key)" @dragstart="draggedKey = node.key" @dragover.prevent @drop.prevent="drop(node.key)">{{ node.label }}</button>
        <label>添加区域<select @change="commit(() => { model.html += templates[($event.target as HTMLSelectElement).value] }); ($event.target as HTMLSelectElement).value = ''"><option value="">选择内容类型</option><option v-for="(_, name) in templates" :key="name" :value="name">{{ name }}</option></select></label>
      </aside>
      <div class="editor-canvas"><div ref="container" /></div>
      <aside v-if="selected || guideOption" class="editor-properties" aria-label="元素属性">
        <template v-if="selected || guideOption">
          <h3>元素属性</h3>
          <button type="button" @click="closeProperties">关闭属性</button>
          <nav aria-label="内容层级"><button v-for="node in breadcrumbs" :key="node.key" type="button" @click="selection(node.key)">{{ node.label }}</button></nav>
          <label v-if="selected && !selected.element.childNodes.some(child => 'tagName' in child) && !['img','input','br','hr'].includes(selected.tag)">文字内容<textarea v-model="text" @change="updateText" /></label>
          <label v-if="selected && ['p','h1','h2','h3','h4','h5','h6'].includes(selected.tag)">文字级别<select :value="selected.tag" @change="commit(() => model.tag(selectedKey, ($event.target as HTMLSelectElement).value))"><option value="p">正文</option><option v-for="level in 6" :key="level" :value="'h' + level">{{ level }} 级标题</option></select></label>
          <template v-if="selected?.tag === 'img'">
            <label>图片地址<input v-model="source" @change="commit(() => model.image(selectedKey, source))" /></label>
            <label>替代文字<input v-model="alt" @change="commit(() => model.attributes(selectedKey, { alt }))" /></label>
          </template>
          <template v-if="guideOption">
            <label>Guide 按钮文字<input :value="guideOption.label" @change="updateGuideLabel(($event.target as HTMLInputElement).value)" /></label>
            <label>搜索 Guide 目标<input v-model="targetSearch" type="search" placeholder="输入屏幕名称或页面标题" /></label>
            <label>Guide 跳转目标<select :value="guideOption.action === 'go_cta' ? 'CTA' : guideOption.action === 'link_page' ? 'page:' + guideOption.pageId : guideOption.targetScreenId" @change="setGuideTarget(($event.target as HTMLSelectElement).value)"><option value="CTA">询盘页面</option><option v-for="screen in filteredScreens" :key="screen.screenId" :value="screen.screenId">{{ screen.title }} · {{ screen.screenId }}</option><option v-for="page in filteredPages" :key="page.pageId" :value="'page:' + page.pageId">页面：{{ page.title }}</option></select></label>
            <button v-if="guideOption.action !== 'link_page'" type="button" @click="previewGuideTarget">预览 Guide 目标</button>
            <a v-else-if="pages?.find(page => page.pageId === guideOption?.pageId)?.publicUrls?.[0]" :href="pages.find(page => page.pageId === guideOption?.pageId)!.publicUrls![0]" target="_blank" rel="noopener">预览目标页面</a>
          </template>
          <template v-else-if="selected && ['a','button','img','p','h1','h2','h3','h4','h5','h6','span'].includes(selected.tag)">
            <label>链接目标<input v-model="href" placeholder="网址、#询盘位置、https://wa.me/号码" @change="commit(() => model.link(selectedKey, href))" /></label>
            <label>本站页面<select @change="choosePage(($event.target as HTMLSelectElement).value)"><option value="">选择页面</option><option v-for="page in pages" :key="page.pageId" :value="page.pageId">{{ page.title }} · {{ page.locale }}</option></select></label>
          </template>
          <template v-if="selected">
          <label>样式作用范围<select v-model="styleScope"><option value="all">全部设备</option><option value="current">当前设备（{{ device === 'mobile' ? '手机' : device === 'tablet' ? '平板' : '桌面' }}）</option></select></label>
          <label>图片用途<select v-model="imagePurpose"><option v-if="selected.tag === 'img'" value="image">当前图片</option><option value="background">区域背景</option></select></label>
          <label>上传替换<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" :disabled="busy" @change="if (selected?.tag !== 'img') imagePurpose = 'background'; upload($event)" /></label>
          <p>支持 JPEG、PNG、WebP、GIF；最大 10 MiB、4000 万像素。{{ busy ? '正在上传…' : '' }}</p>
          <label>图库<select @change="if (selected?.tag !== 'img') imagePurpose = 'background'; replaceImage(($event.target as HTMLSelectElement).value)"><option value="">选择已上传图片</option><option v-for="asset in assets" :key="asset.assetId" :value="asset.url">{{ asset.name }} · {{ asset.width }}×{{ asset.height }}</option></select></label>
          <label>元素名称<input :value="selectedElement?.getAttribute('aria-label') || ''" @change="commit(() => model.attributes(selectedKey, { 'aria-label': ($event.target as HTMLInputElement).value }))" /></label>
          <label v-for="property in ['color','background-color','font-family','font-size','padding','margin','width','height','border-radius']" :key="property">{{ styleLabels[property] }}<input :value="styleValues[property]" @change="updateStyle(property, ($event.target as HTMLInputElement).value)" /></label>
          <label>文字排列<select :value="styleValues['text-align']" @change="updateStyle('text-align', ($event.target as HTMLSelectElement).value)"><option value="">沿用页面设置</option><option value="left">左侧</option><option value="center">居中</option><option value="right">右侧</option></select></label>
          <label>字体粗细<select :value="styleValues['font-weight']" @change="updateStyle('font-weight', ($event.target as HTMLSelectElement).value)"><option value="">沿用页面设置</option><option value="normal">标准</option><option value="bold">加粗</option></select></label>
          <template v-if="selected.tag === 'img'"><label>图片裁剪<select :value="styleValues['object-fit']" @change="updateStyle('object-fit', ($event.target as HTMLSelectElement).value)"><option value="">沿用页面设置</option><option value="contain">完整显示</option><option value="cover">填满显示区域</option><option value="fill">伸展填满</option></select></label><label>显示比例<input :value="styleValues['aspect-ratio']" placeholder="例如 16 / 9" @change="updateStyle('aspect-ratio', ($event.target as HTMLInputElement).value)" /></label></template>
          <details><summary>高级 CSS 属性</summary><label v-for="(_, property) in styleValues" :key="property">{{ property }}<input :value="styleValues[property]" @change="updateStyle(String(property), ($event.target as HTMLInputElement).value)" /></label></details>
          <details><summary>高级 HTML 属性</summary><label>HTML 属性名称<select v-model="attributeName"><option v-for="name in ['title','lang','dir','role','tabindex','aria-label','aria-description','aria-hidden','aria-live']" :key="name" :value="name">{{ name }}</option></select></label><label>HTML 属性值<input v-model="attributeValue" /></label><button type="button" @click="applyAttribute">应用属性</button><p>允许修改语义和无障碍属性。系统标识与事件处理由系统维护。</p></details>
          <div class="editor-actions"><button type="button" @click="moveSelected(-1)">上移</button><button type="button" @click="moveSelected(1)">下移</button><button type="button" @click="duplicateSelected">复制区域</button><button type="button" @click="requestRemoval">删除区域</button></div>
          </template>
        </template>
        <p v-else>点击页面中的文字、图片、按钮或区域，修改所选内容。</p>
      </aside>
    </div>
    <section v-if="ads && screenId" class="editor-toolbar" aria-label="Guide 按钮"><strong>Guide 按钮</strong><button v-for="option in ads.guide.nodes[screenId]?.options || []" :key="option.id" type="button" @click="selectedKey = ''; selectedGuideId = option.id">{{ option.label }}</button><p v-if="!ads.guide.nodes[screenId]?.options.length">当前屏没有 Guide 选项。</p></section>
    <section v-if="ads" aria-label="Guide 检查"><p v-if="!guideIssues.length" class="ok">Guide 路径检查通过</p><ul v-else class="error"><li v-for="(issue,index) in guideIssues" :key="index">{{ issue.message }}<span v-if="issue.screenId"> · 当前屏：{{ ads.screens.find(screen => screen.screenId === issue.screenId)?.title || issue.screenId }}</span><span v-if="issue.optionId"> · 按钮：{{ issue.optionId }}</span></li></ul></section>
    <section v-if="mode === 'experience'" class="experience-preview"><p>体验模式中的询盘不会发送，外部跳转和网络业务请求受到限制。</p><iframe :srcdoc="experience" sandbox="allow-scripts" title="页面体验预览" :style="{ width: device === 'mobile' ? '390px' : device === 'tablet' ? '768px' : '1100px' }" /></section>
  </section>
</template>

<style scoped>
.visual-editor{border:1px solid var(--line,#ddd);border-radius:12px;overflow:hidden;background:white}.editor-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px;border-bottom:1px solid #ddd}.editor-toolbar label{margin:0}.editor-columns{display:grid;grid-template-columns:180px minmax(240px,1fr) 270px;min-height:650px}.editor-outline,.editor-properties{padding:12px;max-height:730px;overflow:auto;background:#fafafa}.editor-outline button{display:block;text-align:left;width:100%;background:transparent;color:#26343b;border:0;padding:7px}.editor-outline button[aria-pressed=true]{background:#d7efe6}.editor-canvas{min-width:0}.editor-properties label{display:block;margin:12px 0}.editor-properties input,.editor-properties select,.editor-properties textarea{width:100%;box-sizing:border-box}.editor-properties nav,.editor-actions{display:flex;flex-wrap:wrap;gap:5px}.editor-properties nav button{font-size:12px;padding:4px}.advanced-html{padding:16px}.advanced-html textarea{width:100%;font-family:monospace}.experience-preview{padding:12px;overflow:auto}.experience-preview iframe{border:0;height:650px;max-width:100%;background:white}@media(max-width:1000px){.editor-columns{grid-template-columns:140px minmax(200px,1fr)}.editor-properties{grid-column:1/-1;max-height:none}}
</style>
<style scoped>
.editor-columns{grid-template-columns:180px minmax(240px,1fr)}
.editor-columns.has-properties{grid-template-columns:180px minmax(240px,1fr) 270px}
@media(max-width:1000px){.editor-columns,.editor-columns.has-properties{grid-template-columns:140px minmax(200px,1fr)}.editor-properties{position:fixed;right:0;top:64px;bottom:0;width:min(340px,calc(100vw - 24px));z-index:110;max-height:none;border-left:1px solid #bbb;box-shadow:-12px 0 30px #142a3c22;box-sizing:border-box}}
</style>

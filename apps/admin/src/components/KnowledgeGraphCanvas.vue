<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import {
  graphSpawnCenter,
  manyBodyChargeForType,
  mergeGraphLayoutNodes,
  nodeRadius as layoutNodeRadius,
} from './knowledgeGraphLayout'

export type GraphCanvasNode = {
  id: string
  label: string
  type: string
  path: string
  linkCount: number
}

export type GraphCanvasEdge = {
  source: string
  target: string
  weight: number
}

const props = defineProps<{
  nodes: GraphCanvasNode[]
  edges: GraphCanvasEdge[]
}>()

const NODE_TYPE_COLORS: Record<string, string> = {
  overview: '#facc15',
  source: '#fb923c',
  synthesis: '#f87171',
  entity: '#60a5fa',
  concept: '#c084fc',
  asset: '#2dd4bf',
  other: '#94a3b8',
}

/** 斥力绝对值；d3 many-body 使用负值，数值越大节点彼此推得越开 */
const DEFAULT_CHARGE_BY_TYPE: Record<string, number> = {
  overview: 100,
  source: 140,
  synthesis: 120,
  entity: 200,
  concept: 110,
  asset: 260,
  other: 140,
}

const CHARGE_MIN = 40
const CHARGE_MAX = 400
const CHARGE_STEP = 10

const ZOOM_MIN_FLOOR = 0.05
const ZOOM_MAX = 4
const ZOOM_STEP = 0.08
const LABEL_EXTRA = 16

type SimNode = SimulationNodeDatum & GraphCanvasNode & { x: number; y: number; r: number }
type SimLink = SimulationLinkDatum<SimNode> & { weight: number }

const canvasRef = ref<HTMLCanvasElement | null>(null)
const zoomPercent = ref(100)
const zoomMinPercent = ref(Math.round(ZOOM_MIN_FLOOR * 100))
const selectedId = ref<string | null>(null)
/** 首次布局未完成前不展示画布，避免先以 100% 缩放出现再突然适应 */
const layoutReady = ref(false)
const panning = ref(false)
const chargeByType = ref<Record<string, number>>({ ...DEFAULT_CHARGE_BY_TYPE })
/** 被隐藏的节点类型；仿真仍保留节点坐标，隐藏后不参与斥力、碰撞与连线力 */
const hiddenTypes = ref<Set<string>>(new Set())

let simulation: ReturnType<typeof forceSimulation<SimNode, SimLink>> | null = null
let simNodes: SimNode[] = []
let simLinks: SimLink[] = []
let raf = 0
let dragNode: SimNode | null = null
let panOrigin = { screenX: 0, screenY: 0, tx: 0, ty: 0 }
let pointerMoved = false
let downScreen = { x: 0, y: 0 }
let width = 800
let height = 520
let shouldFitAfterLayout = true
/** 世界坐标到屏幕：screen = world * k + t */
let transform = { x: 0, y: 0, k: 1 }

const neighborIds = computed(() => {
  const id = selectedId.value
  const set = new Set<string>()
  if (!id) return set
  set.add(id)
  for (const edge of props.edges) {
    if (edge.source === id) set.add(edge.target)
    if (edge.target === id) set.add(edge.source)
  }
  return set
})

function nodeRadius(node: GraphCanvasNode): number {
  return layoutNodeRadius(node.linkCount)
}

function colorFor(type: string): string {
  return NODE_TYPE_COLORS[type] ?? NODE_TYPE_COLORS.other!
}

function isTypeVisible(type: string): boolean {
  return !hiddenTypes.value.has(type)
}

function isNodeVisible(node: { type: string }): boolean {
  return isTypeVisible(node.type)
}

function visibleNodeCount(): number {
  let count = 0
  for (const node of simNodes) {
    if (isNodeVisible(node)) count += 1
  }
  return count
}

function toggleTypeVisibility(type: string): void {
  const next = new Set(hiddenTypes.value)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  hiddenTypes.value = next
  if (selectedId.value) {
    const selected = simNodes.find((node) => node.id === selectedId.value)
    if (selected && !isNodeVisible(selected)) {
      selectedId.value = null
    }
  }
  bindVisibilityAwareForces()
  if (simulation && layoutReady.value) {
    simulation.alpha(0.45).restart()
  }
  scheduleDraw()
}

function chargeStrengthFor(node: SimNode): number {
  if (!isNodeVisible(node)) return 0
  return manyBodyChargeForType(
    node.type,
    chargeByType.value,
    visibleNodeCount(),
    DEFAULT_CHARGE_BY_TYPE.other,
  )
}

function linkStrengthFor(link: SimLink): number {
  const source = link.source as SimNode
  const target = link.target as SimNode
  if (!isNodeVisible(source) || !isNodeVisible(target)) return 0
  return 0.4
}

function collideRadiusFor(node: SimNode): number {
  if (!isNodeVisible(node)) return 0
  return node.r + 10
}

function bindVisibilityAwareForces(): void {
  if (!simulation) return
  simulation.force('charge', forceManyBody<SimNode>().strength((node) => chargeStrengthFor(node)))
  simulation.force(
    'collide',
    forceCollide<SimNode>().radius((node) => collideRadiusFor(node)).strength(0.8),
  )
  simulation.force(
    'link',
    forceLink<SimNode, SimLink>(simLinks)
      .id((node) => node.id)
      .distance((link) => 90 / Math.max(link.weight, 0.2))
      .strength((link) => linkStrengthFor(link)),
  )
}

function setTypeCharge(type: string, value: number): void {
  const next = Math.min(CHARGE_MAX, Math.max(CHARGE_MIN, Math.round(value)))
  chargeByType.value = { ...chargeByType.value, [type]: next }
  if (!simulation) return
  simulation.force('charge', forceManyBody<SimNode>().strength((node) => chargeStrengthFor(node)))
  if (!layoutReady.value) return
  simulation.alpha(0.35).restart()
}

function clampZoom(k: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN_FLOOR, k))
}

function syncZoomPercent(): void {
  zoomPercent.value = Math.round(transform.k * 100)
}

function contentBounds(): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of simNodes) {
    if (!isNodeVisible(node)) continue
    if (node.x === undefined || node.y === undefined) continue
    minX = Math.min(minX, node.x - node.r)
    maxX = Math.max(maxX, node.x + node.r)
    minY = Math.min(minY, node.y - node.r)
    maxY = Math.max(maxY, node.y + node.r + LABEL_EXTRA)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null
  const w = Math.max(maxX - minX, 1)
  const h = Math.max(maxY - minY, 1)
  return { minX, minY, maxX, maxY, w, h }
}

function fitToView(): void {
  const bounds = contentBounds()
  if (!bounds) return
  // 避开左下图例（含斥力滑条）、右下缩放条
  const padL = 250
  const padR = 220
  const padT = 28
  const padB = 72
  const availW = Math.max(80, width - padL - padR)
  const availH = Math.max(80, height - padT - padB)
  const fitted = Math.min(availW / bounds.w, availH / bounds.h, ZOOM_MAX)
  const k = clampZoom(fitted)
  zoomMinPercent.value = Math.max(1, Math.min(Math.round(ZOOM_MIN_FLOOR * 100), Math.round(k * 100)))
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const viewCx = padL + availW / 2
  const viewCy = padT + availH / 2
  transform = {
    k,
    x: viewCx - cx * k,
    y: viewCy - cy * k,
  }
  syncZoomPercent()
  scheduleDraw()
}

function applyZoomAt(nextK: number, screenX: number, screenY: number): void {
  const k0 = transform.k
  const k1 = clampZoom(nextK)
  if (k1 === k0) {
    syncZoomPercent()
    return
  }
  const worldX = (screenX - transform.x) / k0
  const worldY = (screenY - transform.y) / k0
  transform = {
    k: k1,
    x: screenX - worldX * k1,
    y: screenY - worldY * k1,
  }
  syncZoomPercent()
  scheduleDraw()
}

function setZoomFromSlider(percent: number): void {
  const nextK = clampZoom(percent / 100)
  applyZoomAt(nextK, width / 2, height / 2)
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  ctx.translate(transform.x, transform.y)
  ctx.scale(transform.k, transform.k)

  const hasSelection = selectedId.value !== null
  const focus = neighborIds.value

  for (const link of simLinks) {
    const source = link.source as SimNode
    const target = link.target as SimNode
    if (!isNodeVisible(source) || !isNodeVisible(target)) continue
    if (source.x === undefined || target.x === undefined) continue
    const linked =
      !hasSelection ||
      (focus.has(source.id) &&
        focus.has(target.id) &&
        (source.id === selectedId.value || target.id === selectedId.value))
    ctx.beginPath()
    ctx.strokeStyle = linked
      ? 'rgba(37, 99, 235, 0.75)'
      : hasSelection
        ? 'rgba(148, 163, 184, 0.12)'
        : 'rgba(148, 163, 184, 0.45)'
    ctx.lineWidth = linked ? 2 / transform.k : 1 / transform.k
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)
    ctx.stroke()
  }

  for (const node of simNodes) {
    if (!isNodeVisible(node)) continue
    if (node.x === undefined || node.y === undefined) continue
    const focused = !hasSelection || focus.has(node.id)
    const isSelected = node.id === selectedId.value
    ctx.beginPath()
    ctx.globalAlpha = focused ? 1 : 0.22
    ctx.fillStyle = colorFor(node.type)
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2)
    ctx.fill()
    if (isSelected) {
      ctx.lineWidth = 3 / transform.k
      ctx.strokeStyle = '#2563eb'
      ctx.stroke()
    } else if (hasSelection && focused) {
      ctx.lineWidth = 2 / transform.k
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.55)'
      ctx.stroke()
    }
    ctx.fillStyle = focused ? '#1e293b' : '#94a3b8'
    ctx.font = `${12 / transform.k}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const label = node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label
    ctx.fillText(label, node.x, node.y + node.r + 2 / transform.k)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

function scheduleDraw(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    draw()
    raf = 0
  })
}

function syncCanvasSize(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const parent = canvas.parentElement
  width = Math.max(320, parent?.clientWidth ?? 800)
  height = Math.max(360, parent?.clientHeight ?? 520)
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
}

function rebuild(): void {
  simulation?.stop()
  syncCanvasSize()

  const keepIds = new Set(props.nodes.map((node) => node.id))
  if (selectedId.value && !keepIds.has(selectedId.value)) {
    selectedId.value = null
  }

  const hadNodes = simNodes.length > 0
  const spawn = graphSpawnCenter(simNodes, { x: width / 2, y: height / 2 })
  const merged = mergeGraphLayoutNodes(
    props.nodes,
    simNodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      vx: node.vx,
      vy: node.vy,
    })),
    spawn,
  )
  const addedCount = merged.filter((node) => node.isNew).length
  simNodes = merged.map(({ isNew: _isNew, ...node }) => node)
  const byId = new Map(simNodes.map((node) => [node.id, node]))
  const nextLinks: SimLink[] = []
  for (const edge of props.edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue
    nextLinks.push({ source, target, weight: edge.weight })
  }
  simLinks = nextLinks

  const firstLayout = !hadNodes && simNodes.length > 0
  shouldFitAfterLayout = firstLayout
  if (firstLayout) {
    layoutReady.value = false
    transform = { x: 0, y: 0, k: 1 }
    syncZoomPercent()
  }

  const alpha = hadNodes ? (addedCount > 0 ? 0.4 : 0.15) : 1
  simulation = forceSimulation(simNodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((node) => node.id)
        .distance((link) => 90 / Math.max(link.weight, 0.2))
        .strength((link) => linkStrengthFor(link)),
    )
    .force('charge', forceManyBody<SimNode>().strength((node) => chargeStrengthFor(node)))
    .force('center', forceCenter(width / 2, height / 2))
    .force(
      'collide',
      forceCollide<SimNode>()
        .radius((node) => collideRadiusFor(node))
        .strength(0.8),
    )
    .alpha(alpha)
    .on('tick', () => {
      if (!layoutReady.value) return
      scheduleDraw()
    })
    .on('end', () => {
      if (shouldFitAfterLayout) {
        shouldFitAfterLayout = false
        fitToView()
        layoutReady.value = true
        scheduleDraw()
        return
      }
      if (layoutReady.value) scheduleDraw()
    })

  if (layoutReady.value) scheduleDraw()
}

function onShellResize(): void {
  syncCanvasSize()
  if (!layoutReady.value) return
  if (simNodes.length > 0) {
    fitToView()
  } else {
    scheduleDraw()
  }
}

function pointerScreen(event: PointerEvent | WheelEvent): { x: number; y: number } {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: (screenX - transform.x) / transform.k,
    y: (screenY - transform.y) / transform.k,
  }
}

function findNodeAtScreen(screenX: number, screenY: number): SimNode | null {
  const world = screenToWorld(screenX, screenY)
  for (let i = simNodes.length - 1; i >= 0; i -= 1) {
    const node = simNodes[i]!
    if (!isNodeVisible(node)) continue
    const dx = world.x - node.x
    const dy = world.y - node.y
    if (dx * dx + dy * dy <= node.r * node.r) {
      return node
    }
  }
  return null
}

function onPointerDown(event: PointerEvent): void {
  if (!layoutReady.value) return
  const pos = pointerScreen(event)
  downScreen = pos
  pointerMoved = false
  dragNode = findNodeAtScreen(pos.x, pos.y)
  if (dragNode) {
    panning.value = false
    dragNode.fx = dragNode.x
    dragNode.fy = dragNode.y
    simulation?.alphaTarget(0.25).restart()
  } else {
    panning.value = true
    panOrigin = { screenX: pos.x, screenY: pos.y, tx: transform.x, ty: transform.y }
  }
  canvasRef.value?.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  const pos = pointerScreen(event)
  if (Math.hypot(pos.x - downScreen.x, pos.y - downScreen.y) > 4) {
    pointerMoved = true
  }
  if (dragNode) {
    const world = screenToWorld(pos.x, pos.y)
    dragNode.fx = world.x
    dragNode.fy = world.y
    return
  }
  if (!panning.value) return
  transform = {
    ...transform,
    x: panOrigin.tx + (pos.x - panOrigin.screenX),
    y: panOrigin.ty + (pos.y - panOrigin.screenY),
  }
  scheduleDraw()
}

function onPointerUp(event: PointerEvent): void {
  const pos = pointerScreen(event)
  if (dragNode || panning.value) {
    canvasRef.value?.releasePointerCapture(event.pointerId)
  }
  if (dragNode) {
    dragNode.fx = null
    dragNode.fy = null
    simulation?.alphaTarget(0)
  }
  if (!pointerMoved) {
    const hit = findNodeAtScreen(pos.x, pos.y)
    selectedId.value = hit ? hit.id : null
    scheduleDraw()
  }
  dragNode = null
  panning.value = false
}

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  const pos = pointerScreen(event)
  const direction = event.deltaY < 0 ? 1 : -1
  applyZoomAt(transform.k * (1 + direction * ZOOM_STEP), pos.x, pos.y)
}

function zoomIn(): void {
  setZoomFromSlider(zoomPercent.value + 10)
}

function zoomOut(): void {
  setZoomFromSlider(zoomPercent.value - 10)
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  rebuild()
  const parent = canvasRef.value?.parentElement
  if (parent) {
    resizeObserver = new ResizeObserver(() => onShellResize())
    resizeObserver.observe(parent)
  }
})

onBeforeUnmount(() => {
  simulation?.stop()
  if (raf) cancelAnimationFrame(raf)
  resizeObserver?.disconnect()
})

watch(
  () => [props.nodes, props.edges] as const,
  () => rebuild(),
  { deep: true },
)

watch(selectedId, () => scheduleDraw())
</script>

<template>
  <div
    class="graph-shell"
    data-testid="knowledge-graph-canvas"
    v-loading="!layoutReady"
    element-loading-text="正在排布关系图…"
  >
    <canvas
      ref="canvasRef"
      class="graph-canvas"
      :class="{ 'is-pending': !layoutReady, 'is-panning': panning }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel.prevent="onWheel"
    />
    <ul v-show="layoutReady" class="graph-legend" data-testid="knowledge-graph-legend">
      <li
        v-for="(color, type) in NODE_TYPE_COLORS"
        :key="type"
        class="legend-row"
        :class="{ 'is-hidden': !isTypeVisible(type) }"
      >
        <button
          type="button"
          class="legend-toggle"
          :aria-pressed="isTypeVisible(type)"
          :aria-label="isTypeVisible(type) ? `隐藏 ${type}` : `显示 ${type}`"
          :title="isTypeVisible(type) ? `隐藏 ${type}` : `显示 ${type}`"
          @click="toggleTypeVisibility(type)"
        >
          <span class="swatch" :style="{ background: isTypeVisible(type) ? color : '#cbd5e1' }" />
          <span class="legend-type">{{ type }}</span>
        </button>
        <input
          class="legend-charge"
          type="range"
          :min="CHARGE_MIN"
          :max="CHARGE_MAX"
          :step="CHARGE_STEP"
          :value="chargeByType[type] ?? DEFAULT_CHARGE_BY_TYPE.other"
          :disabled="!isTypeVisible(type)"
          :aria-label="`${type} 斥力`"
          :title="`斥力 ${chargeByType[type] ?? DEFAULT_CHARGE_BY_TYPE.other}`"
          @click.stop
          @input="setTypeCharge(type, Number(($event.target as HTMLInputElement).value))"
        >
        <span class="legend-charge-value">{{ chargeByType[type] ?? DEFAULT_CHARGE_BY_TYPE.other }}</span>
      </li>
    </ul>
    <div v-show="layoutReady" class="graph-zoom" data-testid="knowledge-graph-zoom">
      <button type="button" class="zoom-btn zoom-fit" aria-label="适应窗口" title="适应窗口" @click="fitToView">
        适应
      </button>
      <button type="button" class="zoom-btn" aria-label="缩小" @click="zoomOut">−</button>
      <input
        class="zoom-slider"
        type="range"
        :min="zoomMinPercent"
        :max="Math.round(ZOOM_MAX * 100)"
        :value="zoomPercent"
        @input="setZoomFromSlider(Number(($event.target as HTMLInputElement).value))"
      />
      <button type="button" class="zoom-btn" aria-label="放大" @click="zoomIn">+</button>
      <span class="zoom-label">{{ zoomPercent }}%</span>
    </div>
  </div>
</template>

<style scoped>
.graph-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 360px;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
}
.graph-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}
.graph-canvas.is-panning {
  cursor: grabbing;
}
.graph-canvas.is-pending {
  visibility: hidden;
  pointer-events: none;
}
.graph-legend {
  position: absolute;
  left: 12px;
  bottom: 12px;
  margin: 0;
  padding: 8px 10px;
  list-style: none;
  display: grid;
  gap: 6px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 8px;
  font-size: 12px;
  color: #334155;
  z-index: 2;
}
.legend-row {
  display: grid;
  grid-template-columns: minmax(0, 74px) 88px 28px;
  align-items: center;
  gap: 6px;
}
.legend-row.is-hidden {
  opacity: 0.45;
}
.legend-row.is-hidden .legend-type,
.legend-row.is-hidden .legend-charge-value {
  color: #94a3b8;
}
.legend-toggle {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.graph-legend .swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.legend-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.legend-charge {
  width: 88px;
  margin: 0;
  accent-color: #2563eb;
  cursor: pointer;
}
.legend-charge:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.legend-charge-value {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #64748b;
}
.graph-zoom {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}
.zoom-btn {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 6px;
  background: #fff;
  color: #0f172a;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.zoom-btn.zoom-fit {
  width: auto;
  padding: 0 8px;
  font-size: 12px;
}
.zoom-btn:hover {
  background: #f8fafc;
}
.zoom-slider {
  width: 120px;
  accent-color: #2563eb;
}
.zoom-label {
  min-width: 44px;
  text-align: right;
  font-size: 12px;
  color: #475569;
}
</style>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'

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

type SimNode = SimulationNodeDatum & GraphCanvasNode & { x: number; y: number; r: number }
type SimLink = SimulationLinkDatum<SimNode> & { weight: number }

const canvasRef = ref<HTMLCanvasElement | null>(null)
let simulation: ReturnType<typeof forceSimulation<SimNode, SimLink>> | null = null
let simNodes: SimNode[] = []
let simLinks: SimLink[] = []
let raf = 0
let dragNode: SimNode | null = null
let width = 800
let height = 520

function nodeRadius(node: GraphCanvasNode): number {
  return Math.min(22, 8 + Math.sqrt(Math.max(node.linkCount, 1)) * 3)
}

function colorFor(type: string): string {
  return NODE_TYPE_COLORS[type] ?? NODE_TYPE_COLORS.other!
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)'
  ctx.lineWidth = 1
  for (const link of simLinks) {
    const source = link.source as SimNode
    const target = link.target as SimNode
    if (source.x === undefined || target.x === undefined) continue
    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)
    ctx.stroke()
  }
  for (const node of simNodes) {
    if (node.x === undefined || node.y === undefined) continue
    ctx.beginPath()
    ctx.fillStyle = colorFor(node.type)
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1e293b'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const label = node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label
    ctx.fillText(label, node.x, node.y + node.r + 2)
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

function rebuild(): void {
  simulation?.stop()
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
  const ctx = canvas.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)

  simNodes = props.nodes.map((node) => ({
    ...node,
    x: width / 2 + (Math.random() - 0.5) * 80,
    y: height / 2 + (Math.random() - 0.5) * 80,
    r: nodeRadius(node),
  }))
  const byId = new Map(simNodes.map((node) => [node.id, node]))
  const nextLinks: SimLink[] = []
  for (const edge of props.edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue
    nextLinks.push({ source, target, weight: edge.weight })
  }
  simLinks = nextLinks

  simulation = forceSimulation(simNodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((node) => node.id)
        .distance((link) => 90 / Math.max(link.weight, 0.2))
        .strength(0.4),
    )
    .force('charge', forceManyBody().strength(-180))
    .force('center', forceCenter(width / 2, height / 2))
    .force(
      'collide',
      forceCollide<SimNode>()
        .radius((node) => node.r + 10)
        .strength(0.8),
    )
    .on('tick', scheduleDraw)

  scheduleDraw()
}

function pointerPos(event: PointerEvent): { x: number; y: number } {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function findNodeAt(x: number, y: number): SimNode | null {
  for (let i = simNodes.length - 1; i >= 0; i -= 1) {
    const node = simNodes[i]!
    const dx = x - node.x
    const dy = y - node.y
    if (dx * dx + dy * dy <= node.r * node.r) {
      return node
    }
  }
  return null
}

function onPointerDown(event: PointerEvent): void {
  const pos = pointerPos(event)
  dragNode = findNodeAt(pos.x, pos.y)
  if (!dragNode) return
  dragNode.fx = dragNode.x
  dragNode.fy = dragNode.y
  simulation?.alphaTarget(0.25).restart()
  canvasRef.value?.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragNode) return
  const pos = pointerPos(event)
  dragNode.fx = pos.x
  dragNode.fy = pos.y
}

function onPointerUp(event: PointerEvent): void {
  if (!dragNode) return
  dragNode.fx = null
  dragNode.fy = null
  dragNode = null
  simulation?.alphaTarget(0)
  canvasRef.value?.releasePointerCapture(event.pointerId)
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  rebuild()
  const parent = canvasRef.value?.parentElement
  if (parent) {
    resizeObserver = new ResizeObserver(() => rebuild())
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
</script>

<template>
  <div class="graph-shell" data-testid="knowledge-graph-canvas">
    <canvas
      ref="canvasRef"
      class="graph-canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />
    <ul class="graph-legend">
      <li v-for="(color, type) in NODE_TYPE_COLORS" :key="type">
        <span class="swatch" :style="{ background: color }" />
        {{ type }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.graph-shell {
  position: relative;
  width: 100%;
  min-height: 420px;
  height: 520px;
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
.graph-legend {
  position: absolute;
  left: 12px;
  bottom: 12px;
  margin: 0;
  padding: 8px 10px;
  list-style: none;
  display: grid;
  gap: 4px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 8px;
  font-size: 12px;
  color: #334155;
}
.graph-legend .swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
}
</style>

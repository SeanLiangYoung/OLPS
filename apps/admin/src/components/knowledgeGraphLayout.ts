export type GraphLayoutNode = {
  id: string
  label: string
  type: string
  path: string
  linkCount: number
}

export type GraphLayoutPosition = {
  id: string
  x: number
  y: number
  vx?: number
  vy?: number
}

export type MergedGraphNode = GraphLayoutNode & {
  x: number
  y: number
  vx?: number
  vy?: number
  r: number
  isNew: boolean
}

export function nodeRadius(linkCount: number): number {
  return Math.min(22, 8 + Math.sqrt(Math.max(linkCount, 1)) * 3)
}

/** 合并新旧图数据：保留已有节点坐标，新节点落在现有节点重心附近 */
export function mergeGraphLayoutNodes(
  nodes: GraphLayoutNode[],
  previous: GraphLayoutPosition[],
  spawn: { x: number; y: number },
  random: () => number = Math.random,
): MergedGraphNode[] {
  const previousById = new Map(previous.map((node) => [node.id, node]))
  return nodes.map((node) => {
    const prior = previousById.get(node.id)
    if (prior) {
      return {
        ...node,
        x: prior.x,
        y: prior.y,
        vx: prior.vx,
        vy: prior.vy,
        r: nodeRadius(node.linkCount),
        isNew: false,
      }
    }
    return {
      ...node,
      x: spawn.x + (random() - 0.5) * 80,
      y: spawn.y + (random() - 0.5) * 80,
      r: nodeRadius(node.linkCount),
      isNew: true,
    }
  })
}

/** 按节点类型与图规模计算 many-body 斥力（负值） */
export function manyBodyChargeForType(
  type: string,
  chargeByType: Record<string, number>,
  nodeCount: number,
  fallback = 140,
): number {
  const magnitude = chargeByType[type] ?? fallback
  const densityScale = nodeCount > 80 ? 2 / 3 : 1
  return -magnitude * densityScale
}

export function graphSpawnCenter(
  previous: Array<{ x?: number; y?: number }>,
  fallback: { x: number; y: number },
): { x: number; y: number } {
  let sumX = 0
  let sumY = 0
  let count = 0
  for (const node of previous) {
    if (node.x === undefined || node.y === undefined) continue
    sumX += node.x
    sumY += node.y
    count += 1
  }
  if (count === 0) return fallback
  return { x: sumX / count, y: sumY / count }
}

import type { AdsPayload, GuideValidationIssue, GuideValidationResult } from './types.js'

function findCtaScreenId(ads: AdsPayload): string | null {
  const ctas = ads.screens.filter((s) => s.role === 'cta')
  if (ctas.length !== 1) return null
  return ctas[0]!.screenId
}

function buildAdjacency(ads: AdsPayload, ctaId: string): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const screen of ads.screens) {
    adj.set(screen.screenId, [])
  }
  for (const [screenId, node] of Object.entries(ads.guide.nodes)) {
    const targets: string[] = []
    for (const option of node.options) {
      if (option.action === 'navigate' && option.targetScreenId) {
        targets.push(option.targetScreenId)
      }
      if (option.action === 'go_cta') {
        targets.push(ctaId)
      }
    }
    adj.set(screenId, targets)
  }
  return adj
}

function hasCycle(adjacency: Map<string, string[]>): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function dfs(nodeId: string): boolean {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visiting.add(nodeId)
    for (const nextId of adjacency.get(nodeId) ?? []) {
      if (dfs(nextId)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }

  for (const nodeId of adjacency.keys()) {
    if (dfs(nodeId)) return true
  }
  return false
}

function canReach(startId: string, targetId: string, adjacency: Map<string, string[]>): boolean {
  const queue = [startId]
  const seen = new Set<string>()
  let head = 0
  while (head < queue.length) {
    const current = queue[head++]!
    if (current === targetId) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const nextId of adjacency.get(current) ?? []) {
      queue.push(nextId)
    }
  }
  return false
}

export function validateGuideGraph(
  ads: AdsPayload,
  options: { screenCap: number },
): GuideValidationResult {
  const issues: GuideValidationIssue[] = []

  if (ads.screens.length > options.screenCap) {
    issues.push({
      code: 'screen_cap_exceeded',
      message: `共用屏块数 ${ads.screens.length} 超过上限 ${options.screenCap}`,
    })
  }

  const ctaScreens = ads.screens.filter((s) => s.role === 'cta')
  if (ctaScreens.length !== 1) {
    issues.push({
      code: 'cta_count',
      message: `全页必须恰好 1 个 CTA 屏，当前 ${ctaScreens.length}`,
    })
  }

  const screenIds = new Set(ads.screens.map((s) => s.screenId))
  if (screenIds.size !== ads.screens.length) {
    issues.push({ code: 'duplicate_screen_id', message: '存在重复的 screenId' })
  }

  for (const keyword of ads.keywordCluster) {
    const entryId = ads.guide.entryByKeyword[keyword]
    if (!entryId) {
      issues.push({
        code: 'missing_entry_mapping',
        message: `关键词 ${keyword} 缺少 entryByKeyword`,
      })
      continue
    }
    const entryScreen = ads.screens.find((s) => s.screenId === entryId)
    if (!entryScreen || entryScreen.role !== 'entry') {
      issues.push({
        code: 'entry_not_entry_role',
        message: `关键词 ${keyword} 的入口屏不是 role=entry`,
        screenId: entryId,
      })
    }
  }

  for (const [screenId, node] of Object.entries(ads.guide.nodes)) {
    if (!screenIds.has(screenId)) {
      issues.push({
        code: 'orphan_guide_node',
        message: `Guide 节点 ${screenId} 不在 screens 中`,
        screenId,
      })
    }
    for (const option of node.options) {
      if (option.action === 'navigate') {
        if (!option.targetScreenId || !screenIds.has(option.targetScreenId)) {
          issues.push({
            code: 'bad_navigate_target',
            message: `选项 ${option.id} 的 navigate 目标无效`,
            screenId,
            optionId: option.id,
          })
        }
      }
    }
  }

  const ctaId = findCtaScreenId(ads)
  if (ctaId) {
    const adjacency = buildAdjacency(ads, ctaId)
    if (hasCycle(adjacency)) {
      issues.push({ code: 'cycle', message: 'Guide 图存在有向环' })
    }
    for (const keyword of ads.keywordCluster) {
      const entryId = ads.guide.entryByKeyword[keyword]
      if (!entryId) continue
      if (!canReach(entryId, ctaId, adjacency)) {
        issues.push({
          code: 'entry_unreachable_cta',
          message: `从关键词 ${keyword} 的入口无法到达 CTA`,
          screenId: entryId,
        })
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

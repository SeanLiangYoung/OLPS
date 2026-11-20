import type { LoadedWorkspace, PlannedFile, PublishConfig, StoredPageJson } from './types.js'

/**
 * 旧单页构建计划入口。Wave 5 将改写 API 预览后删除。
 * 当前调用会立即失败，避免静默产出错误 HTML。
 */
export function computeBuildPlan(_loaded: LoadedWorkspace): PlannedFile[] {
  throw new Error(
    'computeBuildPlan 已由整站 buildSite 取代；API 预览将在 Wave 5 改用 preview.ts',
  )
}

export type { LoadedWorkspace, PlannedFile, PublishConfig, StoredPageJson }

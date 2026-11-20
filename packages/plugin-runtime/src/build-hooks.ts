import { PluginRuntimeError, toPluginRuntimeError } from './errors.js'
import { runPluginExport } from './isolate.js'
import type {
  PluginOnBuildFile,
  PluginPermissions,
  PluginRuntimeBindings,
} from './types.js'

export const BUILD_HOOKS_TOTAL_TIMEOUT_MS = 60_000

export type BuildHookBaseOptions = {
  pluginId: string
  scriptSource: string
  permissions: PluginPermissions
  settings: Record<string, unknown>
  site?: unknown
  store?: PluginRuntimeBindings['store']
  inquiries?: PluginRuntimeBindings['inquiries']
  log: PluginRuntimeBindings['log']
  fetchImpl?: PluginRuntimeBindings['fetchImpl']
  timeoutBudgetMs?: number
}

export type RunOnBuildResult = {
  files: PluginOnBuildFile[]
  remainingMs: number
}

export type RunTransformHtmlResult = {
  html: string
  remainingMs: number
}

function toBindings(options: BuildHookBaseOptions): PluginRuntimeBindings {
  return {
    settings: options.settings,
    site: options.site,
    store: options.store,
    inquiries: options.inquiries,
    log: options.log,
    fetchImpl: options.fetchImpl,
  }
}

function normalizePluginPublicPath(pluginId: string, filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new PluginRuntimeError(pluginId, `onBuild path must be relative: ${filePath}`)
  }
  if (normalized.split('/').includes('..')) {
    throw new PluginRuntimeError(pluginId, `onBuild path escapes plugin directory: ${filePath}`)
  }
  const prefix = `public/plugins/${pluginId}/`
  if (!normalized.startsWith(prefix) || normalized.length <= prefix.length) {
    throw new PluginRuntimeError(
      pluginId,
      `onBuild path must stay under ${prefix}: ${filePath}`,
    )
  }
  return normalized
}

function normalizeOnBuildFiles(pluginId: string, raw: unknown): PluginOnBuildFile[] {
  if (raw === undefined || raw === null) {
    return []
  }
  if (!Array.isArray(raw)) {
    throw new PluginRuntimeError(pluginId, 'onBuild must return an array of files')
  }
  const files: PluginOnBuildFile[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      throw new PluginRuntimeError(pluginId, 'onBuild file entry must be an object')
    }
    const record = entry as Record<string, unknown>
    if (typeof record.path !== 'string') {
      throw new PluginRuntimeError(pluginId, 'onBuild file path must be a string')
    }
    if (typeof record.content !== 'string') {
      throw new PluginRuntimeError(pluginId, 'onBuild file content must be a string')
    }
    files.push({
      path: normalizePluginPublicPath(pluginId, record.path),
      content: record.content,
    })
  }
  return files
}

async function withBudget<T>(
  pluginId: string,
  timeoutBudgetMs: number,
  run: (timeoutMs: number) => Promise<T>,
): Promise<{ value: T; remainingMs: number }> {
  const startedAt = Date.now()
  try {
    const value = await run(timeoutBudgetMs)
    const elapsed = Date.now() - startedAt
    return {
      value,
      remainingMs: Math.max(0, timeoutBudgetMs - elapsed),
    }
  } catch (error) {
    throw toPluginRuntimeError(pluginId, error)
  }
}

export async function runOnBuild(options: BuildHookBaseOptions): Promise<RunOnBuildResult> {
  const timeoutBudgetMs = options.timeoutBudgetMs ?? BUILD_HOOKS_TOTAL_TIMEOUT_MS
  const { value, remainingMs } = await withBudget(options.pluginId, timeoutBudgetMs, async (timeoutMs) => {
    return await runPluginExport<unknown>({
      pluginId: options.pluginId,
      scriptSource: options.scriptSource,
      filename: `plugin:${options.pluginId}:server/build.js`,
      permissions: options.permissions,
      bindings: toBindings(options),
      timeoutMs,
      exportName: 'onBuild',
      args: [],
    })
  })

  return {
    files: normalizeOnBuildFiles(options.pluginId, value),
    remainingMs,
  }
}

export async function runTransformHtml(
  options: BuildHookBaseOptions & {
    html: string
    pageInfo: Record<string, unknown>
  },
): Promise<RunTransformHtmlResult> {
  const timeoutBudgetMs = options.timeoutBudgetMs ?? BUILD_HOOKS_TOTAL_TIMEOUT_MS
  const { value, remainingMs } = await withBudget(options.pluginId, timeoutBudgetMs, async (timeoutMs) => {
    return await runPluginExport<unknown>({
      pluginId: options.pluginId,
      scriptSource: options.scriptSource,
      filename: `plugin:${options.pluginId}:server/build.js`,
      permissions: options.permissions,
      bindings: toBindings(options),
      timeoutMs,
      exportName: 'transformHtml',
      args: [options.html, options.pageInfo],
    })
  })

  if (typeof value !== 'string') {
    throw new PluginRuntimeError(options.pluginId, 'transformHtml must return a string')
  }

  return {
    html: value,
    remainingMs,
  }
}

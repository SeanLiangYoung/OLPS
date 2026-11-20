import { PluginRuntimeError, toPluginRuntimeError } from './errors.js'
import { runPluginExport } from './isolate.js'
import type {
  PluginApiRequest,
  PluginApiResponse,
  PluginPermissions,
  PluginRuntimeBindings,
} from './types.js'

export const PLUGIN_API_TIMEOUT_MS = 5_000

export type RunPluginApiOptions = {
  pluginId: string
  scriptSource: string
  permissions: PluginPermissions
  settings: Record<string, unknown>
  store?: PluginRuntimeBindings['store']
  inquiries?: PluginRuntimeBindings['inquiries']
  log: PluginRuntimeBindings['log']
  fetchImpl?: PluginRuntimeBindings['fetchImpl']
  request: PluginApiRequest
}

function toBindings(options: RunPluginApiOptions): PluginRuntimeBindings {
  return {
    settings: options.settings,
    store: options.store,
    inquiries: options.inquiries,
    log: options.log,
    fetchImpl: options.fetchImpl,
  }
}

function normalizeResponse(pluginId: string, raw: unknown): PluginApiResponse {
  if (raw === null || typeof raw !== 'object') {
    throw new PluginRuntimeError(pluginId, 'handle must return an object')
  }
  const record = raw as Record<string, unknown>
  if (typeof record.status !== 'number' || !Number.isInteger(record.status)) {
    throw new PluginRuntimeError(pluginId, 'handle status must be an integer')
  }
  const response: PluginApiResponse = {
    status: record.status,
  }
  if (record.headers !== undefined) {
    if (record.headers === null || typeof record.headers !== 'object' || Array.isArray(record.headers)) {
      throw new PluginRuntimeError(pluginId, 'handle headers must be an object')
    }
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(record.headers as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new PluginRuntimeError(pluginId, `handle header "${key}" must be a string`)
      }
      headers[key] = value
    }
    response.headers = headers
  }
  if ('body' in record) {
    response.body = record.body
  }
  return response
}

export async function runPluginApi(options: RunPluginApiOptions): Promise<PluginApiResponse> {
  try {
    const raw = await runPluginExport<unknown>({
      pluginId: options.pluginId,
      scriptSource: options.scriptSource,
      filename: `plugin:${options.pluginId}:server/api.js`,
      permissions: options.permissions,
      bindings: toBindings(options),
      timeoutMs: PLUGIN_API_TIMEOUT_MS,
      exportName: 'handle',
      args: [options.request],
    })
    return normalizeResponse(options.pluginId, raw)
  } catch (error) {
    throw toPluginRuntimeError(options.pluginId, error)
  }
}

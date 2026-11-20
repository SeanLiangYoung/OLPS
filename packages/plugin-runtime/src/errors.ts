export class PluginRuntimeError extends Error {
  readonly pluginId: string

  constructor(pluginId: string, message: string, cause?: unknown) {
    super(`plugin ${pluginId}: ${message}`)
    this.name = 'PluginRuntimeError'
    this.pluginId = pluginId
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

export function toPluginRuntimeError(pluginId: string, error: unknown): PluginRuntimeError {
  if (error instanceof PluginRuntimeError) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  const prefix = `plugin ${pluginId}: `
  if (message.startsWith(prefix)) {
    return new PluginRuntimeError(pluginId, message.slice(prefix.length), error)
  }
  if (message.includes(pluginId)) {
    return new PluginRuntimeError(pluginId, message, error)
  }
  return new PluginRuntimeError(pluginId, message, error)
}

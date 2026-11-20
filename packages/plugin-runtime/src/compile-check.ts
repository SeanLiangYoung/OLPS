import { toPluginRuntimeError } from './errors.js'
import { compileScriptSource } from './isolate.js'

export type CompilePluginScript = {
  path: string
  source: string
}

export type CompilePluginServerScriptsOptions = {
  pluginId: string
  scripts: CompilePluginScript[]
}

export async function compilePluginServerScripts(
  options: CompilePluginServerScriptsOptions,
): Promise<void> {
  for (const script of options.scripts) {
    try {
      await compileScriptSource(script.source, `plugin:${options.pluginId}:${script.path}`)
    } catch (error) {
      throw toPluginRuntimeError(options.pluginId, error)
    }
  }
}

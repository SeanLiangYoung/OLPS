import ivm from 'isolated-vm'

import { installPluginContext } from './context.js'
import { toPluginRuntimeError } from './errors.js'
import type { PluginPermissions, PluginRuntimeBindings } from './types.js'

export const ISOLATE_MEMORY_LIMIT_MB = 128

const CALL_EXPORT_SOURCE = `
globalThis.__olpsCallExport = function(exportName, args) {
  const fn = globalThis.__olpsExports[exportName];
  if (typeof fn !== 'function') {
    throw new Error('export "' + exportName + '" is missing');
  }
  const callArgs = args.slice();
  callArgs.push(globalThis.__olpsCtx);
  return fn.apply(undefined, callArgs);
};
`

export function wrapCommonJsSource(source: string): string {
  return [
    'const module = { exports: {} };',
    'const exports = module.exports;',
    source,
    'globalThis.__olpsExports = module.exports;',
  ].join('\n')
}

export type RunIsolateOptions = {
  pluginId: string
  scriptSource: string
  filename: string
  permissions: PluginPermissions
  bindings: PluginRuntimeBindings
  timeoutMs: number
  exportName: string
  args: unknown[]
}

export async function runPluginExport<T>(options: RunIsolateOptions): Promise<T> {
  if (options.timeoutMs <= 0) {
    throw toPluginRuntimeError(options.pluginId, 'execution timeout budget exhausted')
  }

  const isolate = new ivm.Isolate({ memoryLimit: ISOLATE_MEMORY_LIMIT_MB })
  try {
    const context = await isolate.createContext()
    const jail = context.global
    await jail.set('global', jail.derefInto())

    await installPluginContext({
      pluginId: options.pluginId,
      isolate,
      context,
      jail,
      permissions: options.permissions,
      bindings: options.bindings,
    })

    const wrapped = wrapCommonJsSource(options.scriptSource)
    const script = await isolate.compileScript(wrapped, {
      filename: options.filename,
    })
    await script.run(context, { timeout: options.timeoutMs })

    const callScript = await isolate.compileScript(CALL_EXPORT_SOURCE, {
      filename: 'olps-call-export.js',
    })
    await callScript.run(context)

    const callRef = await jail.get('__olpsCallExport', { reference: true })
    if (callRef === undefined || callRef === null) {
      throw toPluginRuntimeError(options.pluginId, 'export caller is missing')
    }

    const result = await (callRef as ivm.Reference<(name: string, args: unknown[]) => unknown>).apply(
      undefined,
      [
        options.exportName,
        new ivm.ExternalCopy(options.args).copyInto(),
      ],
      {
        timeout: options.timeoutMs,
        result: { copy: true, promise: true },
      },
    )

    return result as T
  } catch (error) {
    throw toPluginRuntimeError(options.pluginId, error)
  } finally {
    isolate.dispose()
  }
}

export async function compileScriptSource(source: string, filename: string): Promise<void> {
  const isolate = new ivm.Isolate({ memoryLimit: ISOLATE_MEMORY_LIMIT_MB })
  try {
    await isolate.compileScript(wrapCommonJsSource(source), { filename })
  } finally {
    isolate.dispose()
  }
}

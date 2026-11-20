import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const packageRoot = path.resolve(here, '..')

export const builtinPluginIds = [
  'inquiry-form',
  'whatsapp',
  'google-maps',
] as const

export type BuiltinPluginId = (typeof builtinPluginIds)[number]

export function pluginRoot(pluginId: BuiltinPluginId): string {
  return path.join(packageRoot, pluginId)
}

import type { EntityId, IsoDateTime, SchemaVersion } from './content.js'

export type PluginConfig = {
  enabled: boolean
  permissionsAcceptedAt: IsoDateTime | null
  permissionsAcceptedBy: EntityId | null
  settings: Record<string, unknown>
}

export type PluginsConfig = {
  schemaVersion: SchemaVersion
  plugins: Record<string, PluginConfig>
}

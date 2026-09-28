import { SITE_PATHS, type SyncWorkspace } from '@olps/sync'
import { installSiteBuilder } from '@olps/site-builder'
import { defaultSiteSettings, type SiteSettings } from '@olps/domain'
import { appConfig } from './config.js'
import { writeSiteSettingsToWorkspace } from './workspace-factory.js'

export const PUBLISH_CONFIG_PATH = 'source/publish-config.json'

export type PublishConfigJson = {
  publicSiteUrl?: string
  publicApiBaseUrl?: string
  siteId?: string
}

export async function writePublishConfigToWorkspace(
  workspace: SyncWorkspace,
  config: PublishConfigJson,
): Promise<void> {
  const content = `${JSON.stringify(config, null, 2)}\n`
  await workspace.writeFile(PUBLISH_CONFIG_PATH, Buffer.from(content, 'utf8'))
}

export async function bootstrapNewDraftWorkspace(
  workspace: SyncWorkspace,
  input: { pendingSiteId: string; publicSiteUrl?: string | null },
): Promise<void> {
  await installSiteBuilder(workspace.getState().workspacePath)
  const settings = defaultSiteSettings(appConfig.defaultScreenCap)
  await writeSiteSettingsToWorkspace(workspace, settings)
  await writePublishConfigToWorkspace(workspace, {
    siteId: input.pendingSiteId,
    publicApiBaseUrl: appConfig.publicApiBaseUrl,
    publicSiteUrl: input.publicSiteUrl ?? undefined,
  })
  await workspace.saveVersion('api: initial site builder and settings')
  const validation = await workspace.runValidation()
  if (!validation.ok) {
    throw new Error(`初始构建失败: ${validation.log}`)
  }
  const dirty = workspace.getState().status === 'dirty'
  if (dirty) {
    await workspace.saveVersion('api: initial public output')
  }
}

export async function ensurePublishConfigForPush(
  workspace: SyncWorkspace,
  input: { siteId: string; publicSiteUrl?: string | null },
): Promise<void> {
  let current: PublishConfigJson = {}
  try {
    const raw = await workspace.readFile(PUBLISH_CONFIG_PATH)
    current = JSON.parse(raw.toString('utf8')) as PublishConfigJson
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('ENOENT')) {
      const msg = (err as NodeJS.ErrnoException).code
      if (msg !== 'ENOENT') {
        throw err
      }
    }
  }
  const next: PublishConfigJson = {
    ...current,
    siteId: input.siteId,
    publicApiBaseUrl: appConfig.publicApiBaseUrl,
    publicSiteUrl: input.publicSiteUrl ?? current.publicSiteUrl,
  }
  const serialized = JSON.stringify(next)
  const prevSerialized = JSON.stringify(current)
  if (serialized === prevSerialized) {
    return
  }
  await writePublishConfigToWorkspace(workspace, next)
  await workspace.saveVersion('api: publish-config before push')
}

export async function workspaceHasSiteBuilder(workspace: SyncWorkspace): Promise<boolean> {
  try {
    const raw = await workspace.readFile(SITE_PATHS.manifest)
    const manifest = JSON.parse(raw.toString('utf8')) as { buildCommand?: string[] }
    return (manifest.buildCommand?.length ?? 0) > 0
  } catch {
    return false
  }
}

export async function readSiteSettingsFromWorkspaceStrict(
  workspace: SyncWorkspace,
): Promise<SiteSettings> {
  const raw = await workspace.readFile(SITE_PATHS.siteSettings)
  return JSON.parse(raw.toString('utf8')) as SiteSettings
}

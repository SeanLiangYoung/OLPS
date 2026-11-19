import { spawnSync } from 'node:child_process'
import { SITE_PATHS, SyncWorkspace } from '@olps/sync'
import { defaultSiteSettings, type SiteSettings } from '@olps/domain'
import { appConfig } from './config.js'
import { pool } from './db.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'

function readWorkspaceFileAtHead(workspace: SyncWorkspace, relativePath: string): Buffer {
  const { workspacePath } = workspace.getState()
  const result = spawnSync('git', ['show', `HEAD:${relativePath}`], {
    cwd: workspacePath,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const detail = result.stderr?.toString('utf8') ?? result.stdout?.toString('utf8') ?? ''
    throw new Error(`git show HEAD:${relativePath} 失败: ${detail}`)
  }
  return Buffer.from(result.stdout)
}

export async function openDraftWorkspace(input: {
  draftId: string
  sandboxId: string
  siteId: string | null
  draftRemoteSiteId?: string | null
  baseCommitId: string | null
  headCommitId: string | null
}): Promise<SyncWorkspace> {
  let remoteSiteId = input.draftRemoteSiteId ?? null
  let baseCommitId = input.baseCommitId
  if (input.siteId) {
    const site = await pool.query(
      `SELECT remote_site_id, published_commit_id FROM sites WHERE site_id=$1`,
      [input.siteId],
    )
    if (site.rowCount) {
      if (!remoteSiteId) {
        remoteSiteId = site.rows[0]!.remote_site_id as string | null
      }
      if (!baseCommitId) {
        baseCommitId = site.rows[0]!.published_commit_id as string | null
      }
    }
  }

  const options = {
    sandboxRoot: appConfig.sandboxRoot,
    draftId: input.sandboxId,
    remote: requireRemoteServiceConfig(),
    remoteSiteId,
    baseCommitId,
    headCommitId: input.headCommitId,
  }

  return SyncWorkspace.open(options)
}

export async function readSiteSettingsFromWorkspace(
  workspace: SyncWorkspace,
): Promise<SiteSettings> {
  const { status } = workspace.getState()
  const raw =
    status === 'merge_conflict' || status === 'awaiting_user'
      ? readWorkspaceFileAtHead(workspace, SITE_PATHS.siteSettings)
      : await workspace.readFile(SITE_PATHS.siteSettings)
  const parsed = JSON.parse(raw.toString('utf8')) as Partial<SiteSettings>
  return { ...defaultSiteSettings(), ...parsed }
}

export async function writeSiteSettingsToWorkspace(
  workspace: SyncWorkspace,
  settings: SiteSettings,
): Promise<void> {
  const content = `${JSON.stringify(settings, null, 2)}\n`
  await workspace.writeFile(SITE_PATHS.siteSettings, Buffer.from(content, 'utf8'))
}

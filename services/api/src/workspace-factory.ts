import { SyncWorkspace } from '@olps/sync'
import { appConfig } from './config.js'
import { pool } from './db.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { siteBuildConfig } from './site-build-config.js'

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
    build: siteBuildConfig({draftId:input.draftId,database:pool}),
  }

  return SyncWorkspace.open(options)
}

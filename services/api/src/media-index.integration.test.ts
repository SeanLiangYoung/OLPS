import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { expect,it } from 'vitest'
import { SyncWorkspace } from '@olps/sync'
import { uploadMedia,readMedia } from './media-routes.js'
import { resourceRevision } from './managed-resource-context.js'
import { refreshContentIndexes } from './content-sandbox.js'
import { createCmsDraft } from './cms-drafts.js'
import { CmsPublicationService,createCmsPublicationSchema } from './cms-publication.js'
import { requireRemoteServiceConfig } from './remote-service-config.js'
import { withCmsContentSite,cmsContentSnapshot } from './test-support/cms-content-fixture.js'

it('真实发布版本复制与Pull重建媒体索引，媒体失败时全部内容索引保持原值',()=>withCmsContentSite(async(context,client)=>{
  await createCmsPublicationSchema(client)
  const sandboxRoot=path.dirname(context.workspace.getState().workspacePath)
  const siteId=(await client.query('SELECT site_id FROM site_drafts WHERE draft_id=$1',[context.draftId])).rows[0].site_id
  const remote=requireRemoteServiceConfig();const service=new CmsPublicationService(context.database,sandboxRoot,remote)
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#2468ab"/></svg>'
  const first=await uploadMedia(context,{fileName:'first.svg',content:Buffer.from(svg)})
  await service.publish(context.userId,siteId,context.draftId,randomUUID())
  const draft=await createCmsDraft(context.userId,siteId,'媒体复制',context.database,sandboxRoot)
  const rows=await client.query('SELECT media_id,revision FROM media WHERE draft_id=$1',[draft.draftId])
  expect(rows.rows).toEqual([{media_id:first.media.mediaId,revision:first.revision}])
  const second=await uploadMedia(context,{fileName:'second.svg',content:Buffer.from(svg.replace('#2468ab','#ac6824'))})
  await service.publish(context.userId,siteId,context.draftId,randomUUID())
  await service.pull(context.userId,siteId,draft.draftId)
  const row=(await client.query('SELECT * FROM site_drafts WHERE draft_id=$1',[draft.draftId])).rows[0]
  const workspace=await SyncWorkspace.open({sandboxRoot,draftId:row.sandbox_id,remote,remoteSiteId:row.remote_site_id,baseCommitId:row.base_commit_id,headCommitId:row.head_commit_id})
  const cloneContext={...context,draftId:draft.draftId,workspace}
  expect((await client.query('SELECT media_id FROM media WHERE draft_id=$1 ORDER BY media_id',[draft.draftId])).rows.map(entry=>entry.media_id)).toEqual([first.media.mediaId,second.media.mediaId].sort())
  const bytes=await workspace.readFile(`source/media/${second.media.mediaId}.json`)
  expect((await readMedia(cloneContext,second.media.mediaId)).revision).toBe(resourceRevision(bytes))
  const snapshot=async()=>({content:await cmsContentSnapshot(cloneContext),media:(await client.query('SELECT * FROM media WHERE draft_id=$1 ORDER BY media_id',[draft.draftId])).rows})
  await workspace.writeFile(`source/media/${second.media.mediaId}.json`,Buffer.from(JSON.stringify({...second.media,path:'source/site-settings.json'})))
  const beforeInvalid=await snapshot()
  await expect(refreshContentIndexes(cloneContext)).rejects.toThrow()
  expect(await snapshot()).toEqual(beforeInvalid)
  await workspace.writeFile(`source/media/${second.media.mediaId}.json`,bytes)
  await client.query("CREATE FUNCTION reject_media_index() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'MEDIA_INDEX_FAILURE'; END $$")
  await client.query('CREATE TRIGGER reject_media_index BEFORE INSERT ON media FOR EACH ROW EXECUTE FUNCTION reject_media_index()')
  const beforeFailure=await snapshot()
  await expect(refreshContentIndexes(cloneContext)).rejects.toThrow('MEDIA_INDEX_FAILURE')
  expect(await snapshot()).toEqual(beforeFailure)
  await client.query('DROP TRIGGER reject_media_index ON media')
  await refreshContentIndexes(cloneContext)
  expect((await readMedia(cloneContext,second.media.mediaId)).revision).toBe(second.revision)
  await workspace.writeFile(`source/media/${second.media.mediaId}.json`,Buffer.from(JSON.stringify({...second.media,size:second.media.size+1})))
  const beforeSizeMismatch=await snapshot()
  await expect(refreshContentIndexes(cloneContext)).rejects.toThrow('VALIDATION_FAILED')
  expect(await snapshot()).toEqual(beforeSizeMismatch)
  await workspace.writeFile(`source/media/${second.media.mediaId}.json`,bytes)
  await fs.rm(path.join(workspace.getState().workspacePath,'source/media',`${first.media.mediaId}.json`))
  await refreshContentIndexes(cloneContext)
  expect((await client.query('SELECT media_id FROM media WHERE draft_id=$1',[draft.draftId])).rows).toEqual([{media_id:second.media.mediaId}])
}),300000)

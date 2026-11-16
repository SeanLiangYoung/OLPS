import { randomUUID } from 'node:crypto'
import type { PageKind } from '@olps/domain'
import type { GenerateOutput } from './generate.js'
import { pool } from './db.js'
import { isDraftOwner } from './permissions.js'
import { assertDraftOrdinaryEditAllowed } from './draft-ordinary-edit-guard.js'
import { fetchDraftRow, openDraftWorkspaceFromRow } from './draft-preview-support.js'
import { readPageFromWorkspace, writePageToWorkspace, pageRecordFromJson, type StoredPageJson } from './page-sandbox.js'
import { getDraftPageForUser } from './drafts-service.js'
import { validatePageBodyWithWorkspace } from './page-body-validation.js'
import { pageJsonPath } from '@olps/sync'
import { assertRewriteComponentsPreserved } from './page-rewrite-proposal.js'

export async function saveGeneratedDraftPageUnlocked(userId: string, draftId: string, input: {
  generated: GenerateOutput; kind: PageKind; sourcePageId?: string; expectedUpdatedAt?: string
  targetPageId?: string; targetExpectedUpdatedAt?: string
  operation: 'generate' | 'rewrite' | 'translate'; translationGroupId?: string; generation: Record<string, unknown>
}) {
  if (!(await isDraftOwner(userId, draftId))) throw new Error('FORBIDDEN')
  const row = await fetchDraftRow(draftId)
  assertDraftOrdinaryEditAllowed(row)
  const workspace = await openDraftWorkspaceFromRow(row)
  const source = input.sourcePageId ? await getDraftPageForUser(userId, draftId, input.sourcePageId) : null
  if (input.operation !== 'generate' && !source) throw new Error('NOT_FOUND')
  if (source && source.updatedAt !== input.expectedUpdatedAt) throw new Error('PAGE_VERSION_CONFLICT')
  if (source && source.kind !== input.kind) throw new Error('页面类型与原页面不一致')
  if (source && input.operation === 'rewrite') assertRewriteComponentsPreserved(source, input.generated)
  const targetId = input.operation === 'rewrite' ? source!.pageId : input.targetPageId ?? randomUUID()
  const target = input.operation === 'rewrite' ? source : input.targetPageId ? await getDraftPageForUser(userId, draftId, input.targetPageId) : null
  if (input.targetPageId && !target) throw new Error('NOT_FOUND')
  if (input.targetPageId && target?.updatedAt !== input.targetExpectedUpdatedAt) throw new Error('PAGE_VERSION_CONFLICT')
  if (input.operation === 'translate' && source!.locale === input.generated.locale) throw new Error('目标语言与源页面语言相同')
  const group = input.translationGroupId || source?.translationGroupId || (input.operation === 'translate' ? source!.pageId : undefined)
  if (input.operation === 'translate' && target && (target.locale !== input.generated.locale || target.translationGroupId !== group)) throw new Error('目标页面不属于所选语言和翻译组')
  const now = new Date(Math.max(Date.now(), Date.parse(target?.updatedAt ?? '1970-01-01') + 1)).toISOString()
  const originalTarget = await readPageFromWorkspace(workspace, targetId)
  const next: StoredPageJson = {
    ...originalTarget, ...input.generated, pageId: targetId, kind: input.kind,
    seo: { ...originalTarget?.seo, ...input.generated.seo },
    locale: input.operation === 'rewrite' ? source!.locale : input.generated.locale,
    status: originalTarget?.status === 'unpublished' ? 'unpublished' : 'draft',
    translationGroupId: group, updatedAt: now,
    metadata: { ...originalTarget?.metadata, generation: input.generation },
  }
  await validatePageBodyWithWorkspace(workspace, next.kind, next.body)
  const originalSource = source && group && source.translationGroupId !== group ? await readPageFromWorkspace(workspace, source.pageId) : null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO pages(page_id,draft_id,site_id,kind,slug,title,status,locale,seo,body,created_at,updated_at,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb)
       ON CONFLICT(draft_id,page_id) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,status=EXCLUDED.status,
         locale=EXCLUDED.locale,seo=EXCLUDED.seo,body=EXCLUDED.body,updated_at=EXCLUDED.updated_at,metadata=EXCLUDED.metadata`,
      [targetId,draftId,row.site_id ?? null,next.kind,next.slug,next.title,next.status,next.locale,JSON.stringify(next.seo),JSON.stringify(next.body),target?.createdAt ?? now,now,JSON.stringify({ ...next.metadata, translationGroupId: group })],
    )
    if (originalSource && source) {
      const sourceStatus = originalSource.status === 'unpublished' ? 'unpublished' : 'draft'
      await client.query(`UPDATE pages SET metadata=jsonb_set(metadata,'{translationGroupId}',to_jsonb($3::text)),updated_at=$4,status=$5 WHERE draft_id=$1 AND page_id=$2`, [draftId,source.pageId,group,now,sourceStatus])
      await writePageToWorkspace(workspace, { ...originalSource, translationGroupId: group, updatedAt: now, status: sourceStatus })
    }
    await writePageToWorkspace(workspace, next)
    await client.query(`UPDATE site_drafts SET head_commit_id=$2,sync_status='dirty',updated_at=NOW() WHERE draft_id=$1`, [draftId,workspace.getState().headCommitId])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (originalTarget) await writePageToWorkspace(workspace, originalTarget)
    else if ((await workspace.listFiles()).includes(pageJsonPath(targetId))) await workspace.deleteFile(pageJsonPath(targetId))
    if (originalSource) await writePageToWorkspace(workspace, originalSource)
    throw error
  } finally {
    client.release()
  }
  return pageRecordFromJson(draftId, row.site_id ? String(row.site_id) : null, next, { createdAt: target?.createdAt ?? now, updatedAt: now })
}

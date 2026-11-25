import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type pg from 'pg'
import { readAssetMeta, assetMetaDir } from './asset-meta.js'
import type { AssetMetaRecord } from './asset-meta.js'
import type { ImportStatusRecord } from './import-service.js'
import { readExtractedText } from './source-processing.js'
import { readFingerprintStore } from './project-fingerprints.js'
import { assertLegalSiteId } from './site-id.js'
import { withKnowledgeProjectionClient } from './projection-db.js'

export class KnowledgeProjectionError extends Error {
  readonly code: 'projection_not_configured' | 'kb_not_found' | 'import_not_found'

  constructor(code: KnowledgeProjectionError['code'], message: string) {
    super(message)
    this.code = code
  }
}

type RebuildSummary = {
  siteId: string
  importId: string | null
  documents: number
  assets: number
  imports: number
}

function stableDocumentId(kbId: string, sourcePath: string): string {
  const digest = createHash('sha256').update(`doc\0${kbId}\0${sourcePath}`).digest('hex')
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-')
}

function titleFromSourcePath(sourcePath: string): string {
  const base = path.posix.basename(sourcePath)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return base
  }
  return base.slice(0, dot)
}

function resolveProjectDir(knowledgeRoot: string, siteId: string): string {
  assertLegalSiteId(siteId)
  const root = path.resolve(knowledgeRoot)
  const projectDir = path.resolve(root, siteId)
  const relative = path.relative(root, projectDir)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`siteId escapes knowledge root: ${siteId}`)
  }
  return projectDir
}

async function readImportStatusRecord(projectDir: string, importId: string): Promise<ImportStatusRecord> {
  const filePath = path.join(projectDir, '.olps-knowledge', 'imports', importId, 'status.json')
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as ImportStatusRecord
}

async function listImportIds(projectDir: string): Promise<string[]> {
  const importsDir = path.join(projectDir, '.olps-knowledge', 'imports')
  let names: string[]
  try {
    names = await fs.readdir(importsDir)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return []
    }
    throw err
  }
  return names.filter((name) => !name.startsWith('.')).sort()
}

async function listAssetMetaIds(projectDir: string): Promise<string[]> {
  const dir = assetMetaDir(projectDir)
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return []
    }
    throw err
  }
  return names.filter((name) => name.endsWith('.json')).map((name) => name.replace(/\.json$/, '')).sort()
}

async function resolveKnowledgeBase(
  client: pg.PoolClient,
  siteId: string,
): Promise<{ kbId: string; ownerUserId: string }> {
  const result = await client.query(
    'SELECT kb_id, owner_user_id FROM knowledge_bases WHERE site_id = $1',
    [siteId],
  )
  if (!result.rowCount) {
    throw new KnowledgeProjectionError('kb_not_found', `knowledge base missing for site: ${siteId}`)
  }
  const row = result.rows[0] as { kb_id: string; owner_user_id: string }
  return { kbId: row.kb_id, ownerUserId: row.owner_user_id }
}

async function upsertImportRow(
  client: pg.PoolClient,
  siteId: string,
  ownerUserId: string,
  record: ImportStatusRecord,
): Promise<void> {
  await client.query(
    `INSERT INTO knowledge_imports(
      import_id, site_id, user_id, draft_id, source_name, status, stats, error, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::timestamptz,$10::timestamptz)
    ON CONFLICT (import_id) DO UPDATE SET
      site_id = EXCLUDED.site_id,
      user_id = EXCLUDED.user_id,
      draft_id = EXCLUDED.draft_id,
      source_name = EXCLUDED.source_name,
      status = EXCLUDED.status,
      stats = EXCLUDED.stats,
      error = EXCLUDED.error,
      updated_at = EXCLUDED.updated_at`,
    [
      record.importId,
      siteId,
      ownerUserId,
      record.draftId,
      record.sourceName,
      record.status,
      JSON.stringify(record.stats),
      record.error,
      record.createdAt,
      record.updatedAt,
    ],
  )
}

async function upsertDocumentFromText(
  client: pg.PoolClient,
  kbId: string,
  importId: string,
  sourcePath: string,
  title: string,
  content: string,
  fingerprint: string,
): Promise<void> {
  const docId = stableDocumentId(kbId, sourcePath)
  await client.query(
    `INSERT INTO knowledge_documents(
      doc_id, kb_id, title, content, created_at, updated_at,
      source_path, source_fingerprint, import_id, kind, wiki_path, asset_refs
    ) VALUES ($1,$2,$3,$4,NOW(),NOW(),$5,$6,$7,'imported_text',NULL,'[]'::jsonb)
    ON CONFLICT (doc_id) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      updated_at = NOW(),
      source_path = EXCLUDED.source_path,
      source_fingerprint = EXCLUDED.source_fingerprint,
      import_id = EXCLUDED.import_id,
      kind = EXCLUDED.kind`,
    [docId, kbId, title, content, sourcePath, fingerprint, importId],
  )
}

async function upsertAssetRow(client: pg.PoolClient, kbId: string, meta: AssetMetaRecord): Promise<void> {
  await client.query(
    `INSERT INTO knowledge_assets(
      asset_id, kb_id, import_id, source_path, fingerprint, mime_type, byte_size,
      width, height, role, role_confidence, role_reason, caption, storage_key,
      promoted_media, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,NULL,NULL,$10,'{}'::jsonb,NOW(),NOW())
    ON CONFLICT (asset_id) DO UPDATE SET
      import_id = EXCLUDED.import_id,
      source_path = EXCLUDED.source_path,
      fingerprint = EXCLUDED.fingerprint,
      mime_type = EXCLUDED.mime_type,
      byte_size = EXCLUDED.byte_size,
      width = EXCLUDED.width,
      height = EXCLUDED.height,
      storage_key = EXCLUDED.storage_key,
      updated_at = NOW()`,
    [
      meta.assetId,
      kbId,
      meta.importId,
      meta.sourcePath,
      meta.fingerprint,
      meta.mime,
      meta.sizeBytes,
      meta.width ?? null,
      meta.height ?? null,
      meta.sourcePath,
    ],
  )
}

async function rebuildImportProjection(
  client: pg.PoolClient,
  knowledgeRoot: string,
  siteId: string,
  kbId: string,
  ownerUserId: string,
  importId: string,
  importRecord?: ImportStatusRecord,
): Promise<{ documents: number; assets: number }> {
  const projectDir = resolveProjectDir(knowledgeRoot, siteId)
  const record = importRecord ?? (await readImportStatusRecord(projectDir, importId))
  await upsertImportRow(client, siteId, ownerUserId, record)

  await client.query(
    "DELETE FROM knowledge_documents WHERE kb_id = $1 AND import_id = $2 AND kind = 'imported_text'",
    [kbId, importId],
  )
  await client.query('DELETE FROM knowledge_assets WHERE kb_id = $1 AND import_id = $2', [kbId, importId])

  const store = await readFingerprintStore(projectDir)
  let documents = 0
  for (const [sourcePath, entry] of Object.entries(store)) {
    if (entry.kind !== 'text' || !entry.extractedRelativePath) {
      continue
    }
    const extracted = await readExtractedText(projectDir, sourcePath)
    if (extracted.importId !== importId) {
      continue
    }
    const title = titleFromSourcePath(sourcePath)
    await upsertDocumentFromText(
      client,
      kbId,
      importId,
      sourcePath,
      title,
      extracted.text,
      extracted.fingerprint,
    )
    documents += 1
  }

  let assets = 0
  for (const assetId of await listAssetMetaIds(projectDir)) {
    const meta = await readAssetMeta(projectDir, assetId)
    if (meta.importId !== importId) {
      continue
    }
    await upsertAssetRow(client, kbId, meta)
    assets += 1
  }

  return { documents, assets }
}

export async function rebuildKnowledgeProjection(input: {
  knowledgeRoot: string
  databaseUrl: string
  siteId: string
  importId?: string | null
  importRecord?: ImportStatusRecord
  env?: NodeJS.ProcessEnv
}): Promise<RebuildSummary> {
  if (!input.databaseUrl.trim()) {
    throw new KnowledgeProjectionError('projection_not_configured', 'DATABASE_URL 未配置')
  }
  const env = input.env ?? process.env
  return withKnowledgeProjectionClient(input.databaseUrl, env, async (client) => {
    const { kbId, ownerUserId } = await resolveKnowledgeBase(client, input.siteId)
    const projectDir = resolveProjectDir(input.knowledgeRoot, input.siteId)
    const importIds = input.importId
    ? [input.importId]
    : await listImportIds(projectDir)

    if (input.importId) {
      const statusPath = path.join(projectDir, '.olps-knowledge', 'imports', input.importId, 'status.json')
      try {
        await fs.access(statusPath)
      } catch {
        throw new KnowledgeProjectionError('import_not_found', `import not found: ${input.importId}`)
      }
    }

    let documents = 0
    let assets = 0
    for (const importId of importIds) {
      const partial = await rebuildImportProjection(
        client,
        input.knowledgeRoot,
        input.siteId,
        kbId,
        ownerUserId,
        importId,
        input.importRecord && input.importRecord.importId === importId ? input.importRecord : undefined,
      )
      documents += partial.documents
      assets += partial.assets
    }

    return {
      siteId: input.siteId,
      importId: input.importId ?? null,
      documents,
      assets,
      imports: importIds.length,
    }
  })
}
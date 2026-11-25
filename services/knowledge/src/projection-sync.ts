import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type pg from 'pg'
import { readAssetMeta, assetMetaDir } from './asset-meta.js'
import type { AssetMetaRecord } from './asset-meta.js'
import type { ImportStatusRecord } from './import-service.js'
import { manualWikiPath } from './manual-document.js'
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
  manualDocuments: number
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
  kind: 'imported_text' | 'wiki_page',
  wikiPath: string | null,
): Promise<void> {
  const docId = stableDocumentId(kbId, sourcePath)
  await client.query(
    `INSERT INTO knowledge_documents(
      doc_id, kb_id, title, content, created_at, updated_at,
      source_path, source_fingerprint, import_id, kind, wiki_path, asset_refs
    ) VALUES ($1,$2,$3,$4,NOW(),NOW(),$5,$6,$7,$8,$9,'[]'::jsonb)
    ON CONFLICT (doc_id) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      updated_at = NOW(),
      source_path = EXCLUDED.source_path,
      source_fingerprint = EXCLUDED.source_fingerprint,
      import_id = EXCLUDED.import_id,
      kind = EXCLUDED.kind,
      wiki_path = EXCLUDED.wiki_path`,
    [docId, kbId, title, content, sourcePath, fingerprint, importId, kind, wikiPath],
  )
}

function parseWikiFrontmatter(raw: string): { title: string; content: string } {
  const normalized = raw.replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n\n?/.exec(normalized)
  if (!match) {
    const titleMatch = /^# (.+)\n/m.exec(normalized)
    const title = titleMatch?.[1]?.trim() ?? 'untitled'
    return { title, content: normalized }
  }
  const front = match[1]
  const body = normalized.slice(match[0].length)
  const titleLine = front.split('\n').find((line) => line.startsWith('title:'))
  let title = 'untitled'
  if (titleLine) {
    const rawTitle = titleLine.slice('title:'.length).trim()
    if (rawTitle.startsWith('"')) {
      title = JSON.parse(rawTitle) as string
    } else {
      title = rawTitle
    }
  }
  return { title: title.trim(), content: body.trim() }
}

async function readWikiProjectionBody(projectDir: string, wikiPath: string): Promise<{ title: string; content: string }> {
  const abs = path.join(projectDir, ...wikiPath.split('/'))
  const raw = await fs.readFile(abs, 'utf8')
  return parseWikiFrontmatter(raw)
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

const MANUAL_SOURCE_PREFIX = 'raw/sources/manual/'

function documentIdFromManualSourcePath(sourcePath: string): string | null {
  if (!sourcePath.startsWith(MANUAL_SOURCE_PREFIX) || !sourcePath.endsWith('.md')) {
    return null
  }
  const id = sourcePath.slice(MANUAL_SOURCE_PREFIX.length, -'.md'.length)
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return null
  }
  return id
}

async function listManualSourcePaths(projectDir: string): Promise<string[]> {
  const manualDir = path.join(projectDir, 'raw', 'sources', 'manual')
  let names: string[]
  try {
    names = await fs.readdir(manualDir)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return []
    }
    throw err
  }
  return names
    .filter((name) => name.endsWith('.md') && /^[0-9a-f-]{36}\.md$/i.test(name))
    .map((name) => `${MANUAL_SOURCE_PREFIX}${name}`)
    .sort()
}

async function upsertManualProjectionRow(
  client: pg.PoolClient,
  kbId: string,
  docId: string,
  title: string,
  content: string,
  sourcePath: string,
  wikiPath: string,
  fingerprint: string,
  sourceDocumentId?: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO knowledge_documents(
      doc_id, kb_id, title, content, source_document_id, created_at, updated_at,
      source_path, source_fingerprint, import_id, kind, wiki_path, asset_refs
    ) VALUES ($1,$2,$3,$4,$5,NOW(),NOW(),$6,$7,NULL,'manual',$8,'[]'::jsonb)
    ON CONFLICT (doc_id) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      updated_at = NOW(),
      source_path = EXCLUDED.source_path,
      source_fingerprint = EXCLUDED.source_fingerprint,
      kind = EXCLUDED.kind,
      wiki_path = EXCLUDED.wiki_path`,
    [docId, kbId, title, content, sourceDocumentId ?? null, sourcePath, fingerprint, wikiPath],
  )
}

export async function deleteManualDocumentProjection(input: {
  databaseUrl: string
  siteId: string
  documentId: string
  env?: NodeJS.ProcessEnv
}): Promise<void> {
  if (!input.databaseUrl.trim()) {
    throw new KnowledgeProjectionError('projection_not_configured', 'DATABASE_URL 未配置')
  }
  const env = input.env ?? process.env
  await withKnowledgeProjectionClient(input.databaseUrl, env, async (client) => {
    const { kbId } = await resolveKnowledgeBase(client, input.siteId)
    await client.query('DELETE FROM knowledge_documents WHERE kb_id = $1 AND doc_id = $2 AND kind = $3', [
      kbId,
      input.documentId,
      'manual',
    ])
  })
}

export async function projectManualDocument(input: {
  knowledgeRoot: string
  databaseUrl: string
  siteId: string
  documentId: string
  title: string
  content: string
  sourcePath: string
  wikiPath: string
  fingerprint: string
  sourceDocumentId?: string | null
  env?: NodeJS.ProcessEnv
}): Promise<void> {
  if (!input.databaseUrl.trim()) {
    throw new KnowledgeProjectionError('projection_not_configured', 'DATABASE_URL 未配置')
  }
  const env = input.env ?? process.env
  await withKnowledgeProjectionClient(input.databaseUrl, env, async (client) => {
    const { kbId } = await resolveKnowledgeBase(client, input.siteId)
    await upsertManualProjectionRow(
      client,
      kbId,
      input.documentId,
      input.title,
      input.content,
      input.sourcePath,
      input.wikiPath,
      input.fingerprint,
      input.sourceDocumentId ?? null,
    )
  })
}

async function rebuildManualDocumentsProjection(
  client: pg.PoolClient,
  kbId: string,
  projectDir: string,
): Promise<number> {
  const paths = await listManualSourcePaths(projectDir)
  const seen = new Set<string>()
  let count = 0
  for (const sourcePath of paths) {
    const docId = documentIdFromManualSourcePath(sourcePath)
    if (!docId) {
      continue
    }
    seen.add(docId)
    const extracted = await readExtractedText(projectDir, sourcePath)
    const rawText = extracted.text
    const titleMatch = /^# (.+)\n/m.exec(rawText)
    const title = titleMatch?.[1]?.trim() ?? docId
    const content = rawText.replace(/^# .+\n\n?/, '')
    const wikiPath = manualWikiPath(docId)
    await upsertManualProjectionRow(
      client,
      kbId,
      docId,
      title,
      content,
      sourcePath,
      wikiPath,
      extracted.fingerprint,
    )
    count += 1
  }
  if (seen.size === 0) {
    await client.query("DELETE FROM knowledge_documents WHERE kb_id = $1 AND kind = 'manual'", [kbId])
    return 0
  }
  await client.query(
    "DELETE FROM knowledge_documents WHERE kb_id = $1 AND kind = 'manual' AND NOT (doc_id = ANY($2::text[]))",
    [kbId, [...seen]],
  )
  return count
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
  const writtenSet = new Set(record.stats.writtenPaths ?? [])
  let documents = 0
  for (const sourcePath of [...writtenSet].sort()) {
    const entry = store[sourcePath]
    if (!entry || entry.kind !== 'text') {
      continue
    }
    const extracted = await readExtractedText(projectDir, sourcePath)
    if (entry.wikiPath) {
      const wikiBody = await readWikiProjectionBody(projectDir, entry.wikiPath)
      await upsertDocumentFromText(
        client,
        kbId,
        importId,
        sourcePath,
        wikiBody.title,
        wikiBody.content,
        extracted.fingerprint,
        'wiki_page',
        entry.wikiPath,
      )
    } else {
      const title = titleFromSourcePath(sourcePath)
      await upsertDocumentFromText(
        client,
        kbId,
        importId,
        sourcePath,
        title,
        extracted.text,
        extracted.fingerprint,
        'imported_text',
        null,
      )
    }
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
    const manualDocuments = await rebuildManualDocumentsProjection(client, kbId, projectDir)

    return {
      siteId: input.siteId,
      importId: input.importId ?? null,
      documents,
      manualDocuments,
      assets,
      imports: importIds.length,
    }
  })
}
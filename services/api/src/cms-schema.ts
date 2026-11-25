import { randomUUID } from 'node:crypto'
import type pg from 'pg'

export async function migrateCmsSchema(client: pg.PoolClient): Promise<void> {
  await client.query('BEGIN')
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('olps-cms-schema'))")
    await client.query("ALTER TABLE sites ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unpublished'")
    await client.query("UPDATE sites SET status='published' WHERE published_commit_id IS NOT NULL AND status='unpublished'")
    const unattached = await client.query('SELECT * FROM site_drafts WHERE site_id IS NULL ORDER BY draft_id FOR UPDATE')
    for (const draft of unattached.rows) {
      const siteId = randomUUID()
      await client.query("INSERT INTO sites(site_id,name,settings,status,created_at,updated_at) VALUES($1,$2,'{}','unpublished',$3,$4)", [siteId,draft.name,draft.created_at,draft.updated_at])
      await client.query('UPDATE site_drafts SET site_id=$1 WHERE draft_id=$2', [siteId,draft.draft_id])
      await client.query('INSERT INTO site_owners(site_id,user_id,created_at) SELECT $1,user_id,created_at FROM draft_owners WHERE draft_id=$2 ON CONFLICT DO NOTHING', [siteId,draft.draft_id])
    }
    await client.query('ALTER TABLE site_drafts ALTER COLUMN site_id SET NOT NULL')
    await client.query('ALTER TABLE site_drafts DROP CONSTRAINT IF EXISTS site_drafts_site_id_fkey')
    await client.query('ALTER TABLE site_drafts ADD CONSTRAINT site_drafts_site_id_fkey FOREIGN KEY(site_id) REFERENCES sites(site_id) ON DELETE CASCADE')
    for(const table of ['inquiries','reports','jobs','analytics_events','site_integrations'])await client.query(`UPDATE ${table} t SET site_id=d.site_id FROM site_drafts d WHERE t.draft_id=d.draft_id AND t.site_id IS NULL`)
    await client.query('UPDATE inquiry_email_outbox o SET site_id=i.site_id FROM inquiries i WHERE o.inquiry_id=i.inquiry_id AND o.site_id IS NULL')
    await client.query('ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS site_id TEXT REFERENCES sites(site_id) ON DELETE CASCADE')
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_bases_site ON knowledge_bases(site_id) WHERE site_id IS NOT NULL')
    const sites = await client.query('SELECT s.site_id,s.name,MIN(o.user_id) AS owner_user_id FROM sites s LEFT JOIN site_owners o USING(site_id) WHERE NOT EXISTS(SELECT 1 FROM knowledge_bases k WHERE k.site_id=s.site_id) GROUP BY s.site_id,s.name')
    for (const site of sites.rows) {
      if (!site.owner_user_id) throw new Error(`网站缺少成员：${site.site_id}`)
      await client.query('INSERT INTO knowledge_bases(kb_id,site_id,owner_user_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,NOW(),NOW())', [randomUUID(),site.site_id,site.owner_user_id,site.name])
    }
    await client.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS source_document_id TEXT')
    await client.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')
    await client.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS source_path TEXT')
    await client.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS source_fingerprint TEXT')
    await client.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS import_id TEXT')
    await client.query("ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'manual'")
    await client.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS wiki_path TEXT')
    await client.query("ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS asset_refs JSONB NOT NULL DEFAULT '[]'::jsonb")
    await client.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='knowledge_documents'::regclass AND conname='knowledge_documents_kind_check') THEN ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_documents_kind_check CHECK(kind IN ('manual','imported_text','wiki_page')); END IF; END $$")
    await client.query(`CREATE TABLE IF NOT EXISTS knowledge_assets(
      asset_id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL REFERENCES knowledge_bases(kb_id) ON DELETE CASCADE,
      import_id TEXT,
      source_path TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size BIGINT NOT NULL,
      width INTEGER,
      height INTEGER,
      role TEXT,
      role_confidence REAL,
      role_reason TEXT,
      caption TEXT,
      storage_key TEXT NOT NULL,
      promoted_media JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
    await client.query('CREATE INDEX IF NOT EXISTS idx_knowledge_assets_kb ON knowledge_assets(kb_id)')
    await client.query(`CREATE TABLE IF NOT EXISTS knowledge_imports(
      import_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      draft_id TEXT REFERENCES site_drafts(draft_id) ON DELETE SET NULL,
      source_name TEXT NOT NULL,
      status TEXT NOT NULL,
      stats JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
    await client.query('CREATE INDEX IF NOT EXISTS idx_knowledge_imports_site ON knowledge_imports(site_id)')
    await client.query('ALTER TABLE pages ADD COLUMN IF NOT EXISTS role TEXT')
    await client.query("ALTER TABLE pages ADD COLUMN IF NOT EXISTS revision TEXT NOT NULL DEFAULT ''")
    await client.query('ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_pkey')
    await client.query('ALTER TABLE pages ADD CONSTRAINT pages_pkey PRIMARY KEY(draft_id,page_id,locale)')
    await client.query('ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_draft_id_slug_key')
    await client.query('DROP INDEX IF EXISTS idx_pages_locale_slug')
    await client.query("CREATE UNIQUE INDEX idx_pages_locale_slug ON pages(draft_id,locale,slug) WHERE role IS DISTINCT FROM 'not-found'")
    await client.query("UPDATE pages SET status='draft' WHERE status='unpublished'")
    await client.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='pages'::regclass AND conname='pages_status_check') THEN ALTER TABLE pages ADD CONSTRAINT pages_status_check CHECK(status IN ('draft','published')); END IF; END $$")
    await client.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='site_drafts'::regclass AND conname='site_drafts_status_check') THEN ALTER TABLE site_drafts ADD CONSTRAINT site_drafts_status_check CHECK(status IN ('active','syncing','conflict','error','archived')); END IF; END $$")
    for (const [table,id] of [['collection_groups','group_id'],['collection_items','item_id']] as const) {
      await client.query(`CREATE TABLE IF NOT EXISTS ${table}(draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE, ${id} TEXT NOT NULL, collection_id TEXT NOT NULL, locale TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published')), revision TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY(draft_id,${id},locale))`)
    }
    await client.query('CREATE TABLE IF NOT EXISTS media(draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,media_id TEXT NOT NULL,data JSONB NOT NULL,revision TEXT NOT NULL,PRIMARY KEY(draft_id,media_id))')
    await client.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='sites'::regclass AND conname='sites_status_check') THEN ALTER TABLE sites ADD CONSTRAINT sites_status_check CHECK(status IN ('unpublished','published')); END IF; END $$")
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error }
}

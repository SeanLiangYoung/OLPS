import type pg from 'pg'
import { pool } from './db.js'

const COLLABORATION_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    account TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sites (
    site_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    settings JSONB NOT NULL,
    remote_site_id TEXT,
    published_commit_id TEXT,
    public_url TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_owners (
    site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (site_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS site_drafts (
    draft_id TEXT PRIMARY KEY,
    site_id TEXT REFERENCES sites(site_id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    sandbox_id TEXT NOT NULL UNIQUE,
    remote_site_id TEXT,
    pending_site_id TEXT,
    base_commit_id TEXT,
    head_commit_id TEXT,
    status TEXT NOT NULL,
    init_status TEXT NOT NULL DEFAULT 'ready',
    sync_status TEXT,
    conflict_message TEXT,
    conflict_summary TEXT,
    validation_log TEXT,
    pending_operation TEXT,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_published_pages (
    site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    locale TEXT NOT NULL,
    seo JSONB NOT NULL,
    body JSONB NOT NULL,
    published_commit_id TEXT NOT NULL,
    PRIMARY KEY (site_id, page_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_remote_site_id ON sites(remote_site_id) WHERE remote_site_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS draft_owners (
    draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (draft_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS pages (
    draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    site_id TEXT,
    kind TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    locale TEXT NOT NULL,
    seo JSONB NOT NULL,
    body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    PRIMARY KEY (draft_id, page_id),
    UNIQUE (draft_id, slug)
  )`,
  `CREATE TABLE IF NOT EXISTS inquiries (
    inquiry_id BIGSERIAL PRIMARY KEY,
    draft_id TEXT REFERENCES site_drafts(draft_id) ON DELETE SET NULL,
    site_id TEXT REFERENCES sites(site_id) ON DELETE SET NULL,
    page_id TEXT,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS inquiry_email_outbox (
    outbox_id BIGSERIAL PRIMARY KEY,
    inquiry_id BIGINT NOT NULL REFERENCES inquiries(inquiry_id) ON DELETE CASCADE,
    site_id TEXT REFERENCES sites(site_id) ON DELETE SET NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_bases (
    kb_id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_base_grants (
    kb_id TEXT NOT NULL REFERENCES knowledge_bases(kb_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (kb_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_documents (
    doc_id TEXT PRIMARY KEY,
    kb_id TEXT NOT NULL REFERENCES knowledge_bases(kb_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,
    site_id TEXT,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    request JSONB NOT NULL,
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_integrations (
    draft_id TEXT PRIMARY KEY REFERENCES site_drafts(draft_id) ON DELETE CASCADE,
    site_id TEXT UNIQUE REFERENCES sites(site_id) ON DELETE SET NULL,
    ads_account_id TEXT NOT NULL DEFAULT '',
    ads_connected BOOLEAN NOT NULL DEFAULT FALSE,
    ga_property_id TEXT NOT NULL DEFAULT '',
    ga_connected BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    report_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    site_id TEXT REFERENCES sites(site_id) ON DELETE SET NULL,
    draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    checklist JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS analytics_events (
    event_id BIGSERIAL PRIMARY KEY,
    draft_id TEXT REFERENCES site_drafts(draft_id) ON DELETE SET NULL,
    site_id TEXT REFERENCES sites(site_id) ON DELETE SET NULL,
    page_id TEXT,
    name TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS draft_preview_capabilities (
    capability_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    page_slug TEXT NOT NULL,
    entry_route TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_preview_capabilities_session ON draft_preview_capabilities(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_preview_capabilities_draft ON draft_preview_capabilities(draft_id, page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_site_owners_user ON site_owners(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_draft_owners_user ON draft_owners(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pages_draft ON pages(draft_id)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_draft ON jobs(draft_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_kb_owner ON knowledge_bases(owner_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_site ON reports(site_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_inquiries_draft ON inquiries(draft_id)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_draft ON analytics_events(draft_id)`,
  `CREATE TABLE IF NOT EXISTS migration_legacy_site_map (
    legacy_site_id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL UNIQUE,
    sandbox_id TEXT NOT NULL,
    migrated_at TIMESTAMPTZ NOT NULL
  )`,
]

export async function migrateWithClient(client: pg.PoolClient): Promise<void> {
  for (const sql of COLLABORATION_SCHEMA_STATEMENTS) {
    await client.query(sql)
  }
}

export async function migrate(): Promise<void> {
  const client = await pool.connect()
  try {
    await migrateWithClient(client)
  } finally {
    client.release()
  }
}

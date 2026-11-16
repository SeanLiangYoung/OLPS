import type pg from 'pg'

export async function migrateSelectedPublicationSchema(client: pg.PoolClient): Promise<void> {
  await client.query(`ALTER TABLE site_published_pages ADD COLUMN IF NOT EXISTS source_page JSONB`)
  await client.query(`CREATE TABLE IF NOT EXISTS selected_publication_tasks (
    task_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,
    site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    base_commit_id TEXT,
    candidate_commit_id TEXT,
    candidate_sandbox_id TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('preview','publishing','reconciling','completed','failed')),
    result JSONB,
    error TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS selected_publication_active_site
    ON selected_publication_tasks(site_id) WHERE status IN ('publishing','reconciling')`)
  await client.query(`CREATE TABLE IF NOT EXISTS draft_page_publication_bases (
    draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    published_commit_id TEXT,
    draft_base_commit_id TEXT,
    page JSONB,
    PRIMARY KEY(draft_id,page_id)
  )`)
}

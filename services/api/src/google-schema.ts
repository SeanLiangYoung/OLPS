import type pg from 'pg'

export async function migrateGoogleSchema(client: Pick<pg.PoolClient, 'query'>): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS google_connections (
    target_key TEXT PRIMARY KEY,
    draft_id TEXT REFERENCES site_drafts(draft_id) ON DELETE CASCADE,
    site_id TEXT REFERENCES sites(site_id) ON DELETE CASCADE,
    tokens_encrypted TEXT NOT NULL,
    scopes TEXT NOT NULL,
    ads_account_id TEXT NOT NULL DEFAULT '',
    ga_property_id TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((draft_id IS NULL) <> (site_id IS NULL))
  )`)
  await client.query(`CREATE TABLE IF NOT EXISTS google_oauth_states (
    state_hash TEXT PRIMARY KEY,
    browser_hash TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    target_key TEXT NOT NULL,
    target_kind TEXT NOT NULL CHECK(target_kind IN ('draft','site')),
    target_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`)
  await client.query(`CREATE INDEX IF NOT EXISTS google_oauth_states_expiry ON google_oauth_states(expires_at)`)
}

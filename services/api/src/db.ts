import pg from 'pg'
import { appConfig } from './config.js'

export const pool = new pg.Pool({ connectionString: appConfig.databaseUrl })

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sites (
      site_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      settings JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      page_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
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
      UNIQUE (tenant_id, site_id, slug)
    );

    CREATE TABLE IF NOT EXISTS inquiries (
      inquiry_id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      page_id TEXT,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS inquiry_email_outbox (
      outbox_id BIGSERIAL PRIMARY KEY,
      inquiry_id BIGINT NOT NULL REFERENCES inquiries(inquiry_id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS knowledge_bases (
      kb_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      doc_id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL REFERENCES knowledge_bases(kb_id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      request JSONB NOT NULL,
      result JSONB,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_integrations (
      site_id TEXT PRIMARY KEY REFERENCES sites(site_id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      ads_account_id TEXT NOT NULL DEFAULT '',
      ads_connected BOOLEAN NOT NULL DEFAULT FALSE,
      ga_property_id TEXT NOT NULL DEFAULT '',
      ga_connected BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      report_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      checklist JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      event_id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      page_id TEXT,
      name TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_pages_tenant_site ON pages(tenant_id, site_id);
    CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_tenant ON jobs(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kb_tenant ON knowledge_bases(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_reports_site ON reports(tenant_id, site_id, created_at DESC);
  `)

  // 兼容早期 inquiries 表无 status 列
  await pool.query(`
    ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new';
    ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `)

  // 租户以 AI Sites 为准，不再维护本地 tenants / tenant_members
  await pool.query(`
    DROP TABLE IF EXISTS tenant_members;
    DROP TABLE IF EXISTS tenants;
  `)
}

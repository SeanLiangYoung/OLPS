import type pg from 'pg'

export const LEGACY_SETTINGS_JSON = JSON.stringify({
  defaultLocale: 'en',
  locales: ['en'],
  analyticsEnabled: false,
  mapsEnabled: false,
  mapsApiKey: '',
  whatsappEnabled: false,
  whatsappNumber: '',
  whatsappLabel: '',
})

async function execStatements(pool: pg.Pool, statements: string[]): Promise<void> {
  for (const sql of statements) {
    await pool.query(sql)
  }
}

export async function createFullLegacyTenantSchema(pool: pg.Pool): Promise<void> {
  await execStatements(pool, [
    `DROP TABLE IF EXISTS analytics_events CASCADE`,
    `DROP TABLE IF EXISTS reports CASCADE`,
    `DROP TABLE IF EXISTS site_integrations CASCADE`,
    `DROP TABLE IF EXISTS jobs CASCADE`,
    `DROP TABLE IF EXISTS knowledge_base_grants CASCADE`,
    `DROP TABLE IF EXISTS knowledge_documents CASCADE`,
    `DROP TABLE IF EXISTS knowledge_bases CASCADE`,
    `DROP TABLE IF EXISTS inquiry_email_outbox CASCADE`,
    `DROP TABLE IF EXISTS inquiries CASCADE`,
    `DROP TABLE IF EXISTS pages CASCADE`,
    `DROP TABLE IF EXISTS draft_owners CASCADE`,
    `DROP TABLE IF EXISTS site_drafts CASCADE`,
    `DROP TABLE IF EXISTS site_owners CASCADE`,
    `DROP TABLE IF EXISTS sites CASCADE`,
    `DROP TABLE IF EXISTS sessions CASCADE`,
    `DROP TABLE IF EXISTS users CASCADE`,
    `CREATE TABLE sites (
      site_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      settings JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE pages (
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
    )`,
    `CREATE TABLE inquiries (
      inquiry_id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      page_id TEXT,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE inquiry_email_outbox (
      outbox_id BIGSERIAL PRIMARY KEY,
      inquiry_id BIGINT NOT NULL REFERENCES inquiries(inquiry_id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE knowledge_bases (
      kb_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE knowledge_documents (
      doc_id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL REFERENCES knowledge_bases(kb_id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE jobs (
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
    )`,
    `CREATE TABLE site_integrations (
      site_id TEXT PRIMARY KEY REFERENCES sites(site_id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      ads_account_id TEXT NOT NULL DEFAULT '',
      ads_connected BOOLEAN NOT NULL DEFAULT FALSE,
      ga_property_id TEXT NOT NULL DEFAULT '',
      ga_connected BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE reports (
      report_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      checklist JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE TABLE analytics_events (
      event_id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      page_id TEXT,
      name TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  ])

  await pool.query(
    `INSERT INTO sites(site_id, tenant_id, name, settings, created_at, updated_at)
     VALUES ('legacy-site-1', 'tenant-legacy-1', 'Legacy Site', $1::jsonb, NOW(), NOW())`,
    [LEGACY_SETTINGS_JSON],
  )

  await pool.query(`
    INSERT INTO pages(
      page_id, site_id, tenant_id, kind, slug, title, status, locale, seo, body, created_at, updated_at, published_at
    ) VALUES
      ('legacy-page-home', 'legacy-site-1', 'tenant-legacy-1', 'site', 'home', 'Home', 'published', 'en',
       '{"title":"Home","description":"Home"}'::jsonb,
       '{"html":"<h1>Home</h1>"}'::jsonb, NOW(), NOW(), NOW()),
      ('legacy-page-about', 'legacy-site-1', 'tenant-legacy-1', 'content', 'about', 'About', 'draft', 'en',
       '{"title":"About","description":"About"}'::jsonb,
       '{"html":"<h1>About</h1>"}'::jsonb, NOW(), NOW(), NULL)
  `)

  await execStatements(pool, [
    `INSERT INTO inquiries(tenant_id, site_id, page_id, payload, status)
     VALUES ('tenant-legacy-1', 'legacy-site-1', 'legacy-page-home', '{"email":"lead@example.com"}'::jsonb, 'new')`,
    `INSERT INTO inquiry_email_outbox(inquiry_id, tenant_id, payload)
     VALUES (1, 'tenant-legacy-1', '{"queued":true}'::jsonb)`,
    `INSERT INTO knowledge_bases(kb_id, tenant_id, name, created_at, updated_at)
     VALUES ('legacy-kb-1', 'tenant-legacy-1', 'Legacy KB', NOW(), NOW())`,
    `INSERT INTO knowledge_documents(doc_id, kb_id, tenant_id, title, content, created_at)
     VALUES ('legacy-doc-1', 'legacy-kb-1', 'tenant-legacy-1', 'Doc', 'Content body', NOW())`,
    `INSERT INTO jobs(job_id, tenant_id, site_id, type, status, request, created_at, updated_at)
     VALUES ('legacy-job-1', 'tenant-legacy-1', 'legacy-site-1', 'generate_page', 'completed', '{}'::jsonb, NOW(), NOW())`,
    `INSERT INTO site_integrations(site_id, tenant_id, updated_at)
     VALUES ('legacy-site-1', 'tenant-legacy-1', NOW())`,
    `INSERT INTO reports(report_id, tenant_id, site_id, page_id, score, checklist, created_at)
     VALUES ('legacy-report-1', 'tenant-legacy-1', 'legacy-site-1', 'legacy-page-home', 80, '[]'::jsonb, NOW())`,
    `INSERT INTO analytics_events(tenant_id, site_id, page_id, name, payload)
     VALUES ('tenant-legacy-1', 'legacy-site-1', 'legacy-page-home', 'page_view', '{}'::jsonb)`,
  ])
}

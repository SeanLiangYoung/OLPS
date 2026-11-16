export const MAIL_SCHEMA_STATEMENTS = [
  `ALTER TABLE inquiry_email_outbox ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE inquiry_email_outbox ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE inquiry_email_outbox ADD COLUMN IF NOT EXISTS last_error TEXT`,
  `ALTER TABLE inquiry_email_outbox ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`,
  `ALTER TABLE inquiry_email_outbox ADD COLUMN IF NOT EXISTS claim_token TEXT`,
  `ALTER TABLE inquiry_email_outbox ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`,
  `ALTER TABLE inquiry_email_outbox ADD COLUMN IF NOT EXISTS message_id TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_inquiry_mail_pending ON inquiry_email_outbox(status, outbox_id)`,
] as const

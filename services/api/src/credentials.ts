import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type pg from 'pg'

export function assertCredentialsKey(value: string = process.env.CREDENTIALS_ENCRYPTION_KEY ?? ''): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('CREDENTIALS_ENCRYPTION_KEY 必须是32字节的base64密钥')
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32 || key.toString('base64') !== value) throw new Error('CREDENTIALS_ENCRYPTION_KEY 必须是32字节的base64密钥')
  return key
}

export function encryptCredential(plaintext: string, scope: string, key: Buffer = assertCredentialsKey()): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(scope))
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') })
}

export function decryptCredential(ciphertext: string, scope: string, key: Buffer = assertCredentialsKey()): string {
  const envelope = JSON.parse(ciphertext) as { version: number; iv: string; tag: string; data: string }
  if (envelope.version !== 1) throw new Error('凭据加密版本无效')
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  if (iv.length !== 12 || tag.length !== 16) throw new Error('凭据加密内容无效')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(Buffer.from(scope))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')
}

export async function createCredentialSchema(client: pg.PoolClient | pg.Client): Promise<void> {
  await client.query('CREATE TABLE IF NOT EXISTS plugin_secrets(draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,site_id TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,plugin_id TEXT NOT NULL,ciphertext TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(draft_id,plugin_id))')
  await client.query('CREATE TABLE IF NOT EXISTS plugin_logs(log_id BIGSERIAL PRIMARY KEY,draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,plugin_id TEXT NOT NULL,level TEXT NOT NULL,message TEXT NOT NULL,meta JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
}

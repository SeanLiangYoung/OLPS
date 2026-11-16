import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { auth, analyticsdata } from 'googleapis/build/src/apis/analyticsdata/index.js'
import type pg from 'pg'
import { pool } from './db.js'
import { isDraftOwner, isSiteOwner } from './permissions.js'

const scopes = ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/adwords']
const googleAdsVersion = 'v26'
export type GoogleTarget = { key: string; kind: 'draft' | 'site'; id: string }
type GoogleTokens = ReturnType<typeof createOAuthClient>['credentials']

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }

function encryptionKey(): Buffer {
  const key = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
  if (!key || !/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY_REQUIRED')
  const decoded = Buffer.from(key, 'base64')
  if (decoded.length !== 32) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY_INVALID')
  return decoded
}

export function sealGoogleTokens(tokens: GoogleTokens, key = encryptionKey()): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}

export function unsealGoogleTokens(value: string, key = encryptionKey()): GoogleTokens {
  const bytes = Buffer.from(value, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as GoogleTokens
}

function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !redirectUri) throw new Error('GOOGLE_OAUTH_NOT_CONFIGURED')
  const uri = new URL(redirectUri)
  if (uri.protocol !== 'https:' && !(uri.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(uri.hostname))) {
    throw new Error('GOOGLE_REDIRECT_URI_INVALID')
  }
  encryptionKey()
  return new auth.OAuth2({ clientId, clientSecret, redirectUri, transporterOptions: { timeout: 30_000 } })
}

export async function resolveGoogleTarget(userId: string, kind: 'draft' | 'site', id: string): Promise<GoogleTarget> {
  if (kind === 'site') {
    if (!(await isSiteOwner(userId, id))) throw new Error('FORBIDDEN')
    return { key: `site:${id}`, kind, id }
  }
  if (!(await isDraftOwner(userId, id))) throw new Error('FORBIDDEN')
  const result = await pool.query(`SELECT site_id FROM site_drafts WHERE draft_id=$1`, [id])
  if (!result.rowCount) throw new Error('FORBIDDEN')
  const siteId = result.rows[0]!.site_id as string | null
  if (siteId) return resolveGoogleTarget(userId, 'site', siteId)
  return { key: `draft:${id}`, kind, id }
}

export async function createGoogleState(userId: string, sessionId: string, target: GoogleTarget) {
  await resolveGoogleTarget(userId, target.kind, target.id)
  const session = await pool.query(`SELECT 1 FROM sessions WHERE session_id=$1 AND user_id=$2 AND expires_at>NOW()`, [sessionId, userId])
  if (!session.rowCount) throw new Error('GOOGLE_SESSION_INVALID')
  const state = randomBytes(32).toString('base64url')
  const browserToken = randomBytes(32).toString('base64url')
  await pool.query(`DELETE FROM google_oauth_states WHERE expires_at<=NOW()`)
  await pool.query(`INSERT INTO google_oauth_states(state_hash,browser_hash,session_id,user_id,target_key,target_kind,target_id,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()+INTERVAL '10 minutes')`,
  [hash(state), hash(browserToken), sessionId, userId, target.key, target.kind, target.id])
  return { state, browserToken }
}

export async function consumeGoogleState(state: string, browserToken: string) {
  if (!state || !browserToken) throw new Error('GOOGLE_STATE_INVALID')
  const result = await pool.query(`DELETE FROM google_oauth_states AS o
    USING sessions AS s WHERE o.state_hash=$1 AND o.browser_hash=$2 AND o.expires_at>NOW()
    AND s.session_id=o.session_id AND s.user_id=o.user_id AND s.expires_at>NOW() RETURNING o.*`, [hash(state), hash(browserToken)])
  if (!result.rowCount) throw new Error('GOOGLE_STATE_INVALID')
  const row = result.rows[0]!
  const userId = String(row.user_id)
  const target = await resolveGoogleTarget(userId, row.target_kind as GoogleTarget['kind'], String(row.target_id))
  if (target.key !== row.target_key) throw new Error('GOOGLE_STATE_INVALID')
  return { userId, target }
}

export async function beginGoogleAuthorization(userId: string, sessionId: string, target: GoogleTarget) {
  const oauth = createOAuthClient()
  const pending = await createGoogleState(userId, sessionId, target)
  return { ...pending, url: oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes, state: pending.state, include_granted_scopes: true }) }
}

export async function finishGoogleAuthorization(state: string, browserToken: string, code: string, denied: boolean) {
  const { userId, target } = await consumeGoogleState(state, browserToken)
  if (denied || !code) throw new Error('GOOGLE_AUTHORIZATION_DENIED')
  const oauth = createOAuthClient()
  const { tokens } = await oauth.getToken(code)
  if (!tokens.refresh_token || !tokens.access_token) throw new Error('GOOGLE_OFFLINE_ACCESS_REQUIRED')
  const granted = tokens.scope?.split(' ') ?? []
  if (!scopes.some((scope) => granted.includes(scope))) throw new Error('GOOGLE_SCOPE_REQUIRED')
  await resolveGoogleTarget(userId, target.kind, target.id)
  await pool.query(`INSERT INTO google_connections(target_key,draft_id,site_id,tokens_encrypted,scopes)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT(target_key) DO UPDATE SET tokens_encrypted=EXCLUDED.tokens_encrypted,
    scopes=EXCLUDED.scopes,ads_account_id='',ga_property_id='',updated_at=NOW()`, [target.key, target.kind === 'draft' ? target.id : null, target.kind === 'site' ? target.id : null, sealGoogleTokens(tokens), granted.join(' ')])
  return target
}

export async function getGoogleStatus(userId: string, target: GoogleTarget) {
  await resolveGoogleTarget(userId, target.kind, target.id)
  const result = await pool.query(`SELECT ads_account_id,ga_property_id,scopes,updated_at FROM google_connections WHERE target_key=$1`, [target.key])
  const row = result.rows[0]
  const granted = row ? String(row.scopes).split(' ') : []
  return {
    configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI && process.env.GOOGLE_TOKEN_ENCRYPTION_KEY),
    adsConfigured: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    connected: Boolean(row),
    adsConnected: granted.includes(scopes[1]!),
    gaConnected: granted.includes(scopes[0]!),
    adsAccountId: row ? String(row.ads_account_id) : '',
    gaPropertyId: row ? String(row.ga_property_id) : '',
    updatedAt: row ? new Date(String(row.updated_at)).toISOString() : null,
  }
}

export function validateGoogleResourceId(service: 'ads' | 'ga', value: string): string {
  const id = service === 'ads' ? value.trim().replaceAll('-', '') : value.trim()
  if (!(service === 'ads' ? /^\d{10}$/ : /^\d{1,20}$/).test(id)) throw new Error('GOOGLE_RESOURCE_ID_INVALID')
  return id
}

async function authorizedClient(userId: string, target: GoogleTarget, scope: string) {
  await resolveGoogleTarget(userId, target.kind, target.id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(`SELECT * FROM google_connections WHERE target_key=$1 FOR UPDATE`, [target.key])
    if (!result.rowCount) throw new Error('GOOGLE_AUTHORIZATION_REQUIRED')
    const row = result.rows[0]!
    if (!String(row.scopes).split(' ').includes(scope)) throw new Error('GOOGLE_SCOPE_REQUIRED')
    const oauth = createOAuthClient()
    oauth.setCredentials(unsealGoogleTokens(String(row.tokens_encrypted)))
    await oauth.getAccessToken()
    await client.query(`UPDATE google_connections SET tokens_encrypted=$2,updated_at=NOW() WHERE target_key=$1`, [target.key, sealGoogleTokens(oauth.credentials)])
    await client.query('COMMIT')
    return { oauth, row }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

function adsHeaders() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
  if (!developerToken) throw new Error('GOOGLE_ADS_NOT_CONFIGURED')
  const headers: Record<string, string> = { 'developer-token': developerToken }
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = validateGoogleResourceId('ads', process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)
  return headers
}

export async function queryGoogleAnalytics(userId: string, target: GoogleTarget, propertyId?: string) {
  const { oauth, row } = await authorizedClient(userId, target, scopes[0]!)
  const id = validateGoogleResourceId('ga', propertyId ?? String(row.ga_property_id))
  const result = await analyticsdata({ version: 'v1beta', auth: oauth, timeout: 30_000 }).properties.runReport({
    property: `properties/${id}`, requestBody: {
      dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }],
      dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }], limit: '28',
    },
  })
  return result.data
}

export async function queryGoogleAds(userId: string, target: GoogleTarget, accountId?: string, pageToken?: string) {
  const headers = adsHeaders()
  const { oauth, row } = await authorizedClient(userId, target, scopes[1]!)
  const id = validateGoogleResourceId('ads', accountId ?? String(row.ads_account_id))
  const result = await oauth.request({
    url: `https://googleads.googleapis.com/${googleAdsVersion}/customers/${id}/googleAds:search`, method: 'POST', headers,
    data: { query: 'SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS ORDER BY campaign.id', ...(pageToken ? { pageToken } : {}) },
  })
  return result.data
}

export async function bindGoogleResources(userId: string, target: GoogleTarget, resources: { adsAccountId?: string; gaPropertyId?: string }) {
  await resolveGoogleTarget(userId, target.kind, target.id)
  if (!resources.adsAccountId && !resources.gaPropertyId) throw new Error('GOOGLE_RESOURCE_ID_REQUIRED')
  const adsId = resources.adsAccountId ? validateGoogleResourceId('ads', resources.adsAccountId) : undefined
  const gaId = resources.gaPropertyId ? validateGoogleResourceId('ga', resources.gaPropertyId) : undefined
  if (adsId) await queryGoogleAds(userId, target, adsId)
  if (gaId) await queryGoogleAnalytics(userId, target, gaId)
  await pool.query(`UPDATE google_connections SET ads_account_id=COALESCE($2,ads_account_id),
    ga_property_id=COALESCE($3,ga_property_id),updated_at=NOW() WHERE target_key=$1`, [target.key, adsId, gaId])
  return getGoogleStatus(userId, target)
}

export async function revokeGoogleAuthorization(userId: string, target: GoogleTarget) {
  await resolveGoogleTarget(userId, target.kind, target.id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(`SELECT tokens_encrypted FROM google_connections WHERE target_key=$1 FOR UPDATE`, [target.key])
    if (result.rowCount) {
      const tokens = unsealGoogleTokens(String(result.rows[0]!.tokens_encrypted))
      const token = tokens.refresh_token ?? tokens.access_token
      if (!token) throw new Error('GOOGLE_TOKEN_MISSING')
      await createOAuthClient().revokeToken(token)
      await client.query(`DELETE FROM google_connections WHERE target_key=$1`, [target.key])
    }
    await client.query(`DELETE FROM google_oauth_states WHERE target_key=$1`, [target.key])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function promoteDraftGoogleConnection(draftId: string, siteId: string, client: Pick<pg.PoolClient, 'query'>): Promise<void> {
  await client.query(`INSERT INTO google_connections(target_key,site_id,tokens_encrypted,scopes,ads_account_id,ga_property_id,updated_at)
    SELECT $2,$3,tokens_encrypted,scopes,ads_account_id,ga_property_id,updated_at FROM google_connections
    WHERE draft_id=$1 ON CONFLICT(target_key) DO NOTHING`, [draftId, `site:${siteId}`, siteId])
  await client.query(`DELETE FROM google_connections WHERE draft_id=$1`, [draftId])
  await client.query(`DELETE FROM google_oauth_states WHERE target_kind='draft' AND target_id=$1`, [draftId])
}

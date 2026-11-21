import { randomBytes, randomUUID, createHash } from 'node:crypto'
import type pg from 'pg'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { assertValidSchema, type PublishConfig } from '@olps/domain'
import { ConnectorConfigurationError, ConnectorRequestError, requireProviderEnvironment, missingProviderEnvironment, validatePublicConnector, providerAuthorizationUrl, exchangeProviderCode, refreshGoogleTokens, listGoogleAccounts, listMetaAccounts, setupGa4, setupGoogleAds, setupSearchConsole, verifySearchConsole, sendGoogleConversion, sendMetaConversion, readGoogleDailyMetrics, readMetaDailyMetrics, type Provider, type OAuthTokens, type IdConnector, type GoogleConnector, type Environment } from '@olps/connectors'
import { requireAuth, getAuthUser, type AuthVariables } from './auth-middleware.js'
import { resolveSessionFromToken } from './sessions.js'
import { pool } from './db.js'
import { encryptCredential, decryptCredential } from './credentials.js'
import { ContentError, withContentTransaction, type ContentContext } from './content-sandbox.js'
import { managedResourceContext, expectedRevision, resourceRevision, writeResource, resourceErrorResponse } from './managed-resource-context.js'

type Connector = GoogleConnector | 'meta' | IdConnector
const connectors: Connector[] = ['ga4', 'googleAds', 'searchConsole', 'meta', 'gtm', 'tiktok', 'linkedin', 'clarity', 'uet']
const connectorSchema = z.enum(['ga4', 'googleAds', 'searchConsole', 'meta', 'gtm', 'tiktok', 'linkedin', 'clarity', 'uet'])
function providerFor(connector: Connector): Provider | null { return connector === 'meta' ? 'meta' : ['ga4', 'googleAds', 'searchConsole'].includes(connector) ? 'google' : null }
type Scope = { key: string; siteId: string; draftId: string | null }

async function scopeFor(context: ContentContext, client: pg.PoolClient): Promise<Scope> {
  const result = await client.query('SELECT s.site_id,s.status FROM sites s JOIN site_drafts d USING(site_id) JOIN site_owners o ON o.site_id=s.site_id AND o.user_id=$2 WHERE d.draft_id=$1', [context.draftId, context.userId])
  if (!result.rowCount) throw new ContentError('FORBIDDEN')
  const siteId = result.rows[0].site_id as string
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`integrations:${siteId}`])
  const published = result.rows[0].status === 'published'
  return { key: published ? `site:${siteId}` : `draft:${context.draftId}`, siteId, draftId: published ? null : context.draftId }
}

async function tokensFor(client: pg.PoolClient, scope: Scope, provider: Provider): Promise<OAuthTokens> {
  const row = await client.query('SELECT ciphertext FROM integration_credentials WHERE scope_key=$1 AND provider=$2', [scope.key, provider])
  if (!row.rowCount) throw new ContentError('NOT_CONNECTED', { provider })
  let tokens = JSON.parse(decryptCredential(row.rows[0].ciphertext, `${scope.key}/${provider}`)) as OAuthTokens
  if (provider === 'google' && tokens.expiresAt && tokens.expiresAt < Date.now() + 60_000) {
    tokens = await refreshGoogleTokens(tokens)
    await client.query('UPDATE integration_credentials SET ciphertext=$3,updated_at=NOW() WHERE scope_key=$1 AND provider=$2', [scope.key, provider, encryptCredential(JSON.stringify(tokens), `${scope.key}/${provider}`)])
  }
  return tokens
}

export async function storeOAuthState(context: ContentContext, sessionId: string, provider: Provider, verifier: string | null, rawState: string = randomBytes(40).toString('base64url')): Promise<string> {
  return withContentTransaction(context, false, async client => {
    const scope = await scopeFor(context, client)
    const session = await client.query('SELECT 1 FROM sessions WHERE session_id=$1 AND user_id=$2 AND expires_at>NOW()', [sessionId, context.userId])
    if (!session.rowCount) throw new ContentError('FORBIDDEN')
    const hash = createHash('sha256').update(rawState).digest('hex')
    await client.query("INSERT INTO integration_oauth_states(state_hash,site_id,draft_id,user_id,session_id,provider,verifier_ciphertext,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()+INTERVAL '10 minutes')", [hash, scope.siteId, context.draftId, context.userId, sessionId, provider, encryptCredential(JSON.stringify({ verifier }), `oauth:${hash}`)])
    return rawState
  })
}

export async function consumeOAuthState(state: string, provider: Provider, database: pg.Pool = pool): Promise<{ userId: string; siteId: string; draftId: string; sessionId: string; verifier: string | null }> {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const hash = createHash('sha256').update(state).digest('hex')
    const result = await client.query('SELECT st.* FROM integration_oauth_states st JOIN sessions s ON s.session_id=st.session_id AND s.user_id=st.user_id JOIN site_owners o ON o.site_id=st.site_id AND o.user_id=st.user_id WHERE state_hash=$1 AND provider=$2 AND consumed_at IS NULL AND st.expires_at>NOW() AND s.expires_at>NOW() FOR UPDATE OF st', [hash, provider])
    if (!result.rowCount) throw new ContentError('OAUTH_STATE_INVALID')
    const row = result.rows[0]
    await client.query('UPDATE integration_oauth_states SET consumed_at=NOW() WHERE state_hash=$1', [hash])
    const { verifier } = JSON.parse(decryptCredential(row.verifier_ciphertext, `oauth:${hash}`)) as { verifier: string | null }
    await client.query('COMMIT')
    return { userId: row.user_id, siteId: row.site_id, draftId: row.draft_id, sessionId: row.session_id, verifier }
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}

export async function beginOAuth(context: ContentContext, sessionId: string, provider: Provider, environment: Environment = process.env): Promise<{ url: string }> {
  const state = randomBytes(40).toString('base64url')
  const authorization = await providerAuthorizationUrl(provider, state, environment)
  await storeOAuthState(context, sessionId, provider, authorization.verifier, state)
  return { url: authorization.url }
}

async function completeOAuth(provider: Provider, state: string, code: string, database:pg.Pool=pool): Promise<{siteId:string;draftId:string}> {
  requireProviderEnvironment(provider)
  const consumed = await consumeOAuthState(state, provider,database)
  const tokens = await exchangeProviderCode(provider, code, consumed.verifier)
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const owner = await client.query('SELECT s.status FROM sites s JOIN site_owners o USING(site_id) JOIN sessions se ON se.user_id=o.user_id WHERE s.site_id=$1 AND o.user_id=$2 AND se.session_id=$3 AND se.expires_at>NOW()', [consumed.siteId, consumed.userId, consumed.sessionId])
    if (!owner.rowCount) throw new ContentError('FORBIDDEN')
    const scope = owner.rows[0].status === 'published' ? `site:${consumed.siteId}` : `draft:${consumed.draftId}`
    await client.query('INSERT INTO integration_credentials(scope_key,site_id,draft_id,provider,ciphertext) VALUES($1,$2,$3,$4,$5) ON CONFLICT(scope_key,provider) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=NOW()', [scope, consumed.siteId, owner.rows[0].status === 'published' ? null : consumed.draftId, provider, encryptCredential(JSON.stringify(tokens), `${scope}/${provider}`)])
    await client.query('COMMIT')
    return {siteId:consumed.siteId,draftId:consumed.draftId}
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function listIntegrations(context: ContentContext): Promise<Array<{ connector: Connector; status: string; accountId: string | null; publicConfig: Record<string, unknown>; missingEnvironment: string[]; lastSyncedAt: string | null; error: string | null }>> {
  return withContentTransaction(context, false, async client => {
    const scope = await scopeFor(context, client)
    const rows = (await client.query('SELECT connector,status,account_id,public_config,last_synced_at,last_error FROM integration_connections WHERE scope_key=$1', [scope.key])).rows
    const authorized = new Set((await client.query('SELECT provider FROM integration_credentials WHERE scope_key=$1', [scope.key])).rows.map(row => row.provider))
    return connectors.map(connector => {
      const row = rows.find(row => row.connector === connector)
      const provider = providerFor(connector)
      return { connector, status: row?.status ?? (provider && authorized.has(provider) ? 'authorized' : 'disconnected'), accountId: row?.account_id ?? null, publicConfig: row?.public_config ?? {}, missingEnvironment: provider ? [...missingProviderEnvironment(provider), ...(connector === 'googleAds' && !process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() ? ['GOOGLE_ADS_DEVELOPER_TOKEN'] : [])] : [], lastSyncedAt: row?.last_synced_at ?? null, error: row?.last_error ?? null }
    })
  })
}

async function writeConnection(context: ContentContext, connector: Connector, publicConfig: Record<string, string>, accountId: string | null, accountConfig: Record<string, unknown>, revision?: string): Promise<void> {
  await withContentTransaction(context, true, async (client, backups) => {
    const scope = await scopeFor(context, client)
    const bytes = await context.workspace.readFile('source/publish-config.json')
    if (revision && resourceRevision(bytes) !== revision) throw new ContentError('REVISION_CONFLICT', { currentRevision: resourceRevision(bytes) })
    const config = JSON.parse(bytes.toString('utf8')) as PublishConfig
    Object.assign(config.connectors, { [connector]: publicConfig })
    assertValidSchema('publish-config', config, 'source/publish-config.json')
    await client.query("INSERT INTO integration_connections(scope_key,site_id,draft_id,connector,status,account_id,account_config,public_config) VALUES($1,$2,$3,$4,'connected',$5,$6,$7) ON CONFLICT(scope_key,connector) DO UPDATE SET status='connected',account_id=EXCLUDED.account_id,account_config=EXCLUDED.account_config,public_config=EXCLUDED.public_config,last_error=NULL,updated_at=NOW()", [scope.key, scope.siteId, scope.draftId, connector, accountId, accountConfig, publicConfig])
    await writeResource(context, backups, 'source/publish-config.json', Buffer.from(`${JSON.stringify(config, null, 2)}\n`))
  })
}

export async function configureIdConnector(context: ContentContext, connector: IdConnector, values: unknown, revision?: string): Promise<void> {
  let validated: Record<string, string>
  try { validated = validatePublicConnector(connector, values) }
  catch { throw new ContentError('VALIDATION_FAILED', { field: 'publicIds' }) }
  await writeConnection(context, connector, validated, null, {}, revision)
}

export async function integrationAccounts(context: ContentContext, connector: GoogleConnector | 'meta') {
  const provider = providerFor(connector)!
  requireProviderEnvironment(provider)
  const tokens = await withContentTransaction(context, false, async client => tokensFor(client, await scopeFor(context, client), provider))
  return connector === 'meta' ? listMetaAccounts(tokens) : listGoogleAccounts(connector, tokens)
}

export async function selectIntegrationAccount(context: ContentContext, connector: GoogleConnector | 'meta', accountId: string, revision?: string): Promise<void> {
  const provider = providerFor(connector)!
  requireProviderEnvironment(provider)
  const source = await withContentTransaction(context, false, async client => ({ tokens: await tokensFor(client, await scopeFor(context, client), provider), scope: await scopeFor(context, client), revision: resourceRevision(await context.workspace.readFile('source/publish-config.json')) }))
  if (revision && revision !== source.revision) throw new ContentError('REVISION_CONFLICT', { currentRevision: source.revision })
  const accounts = connector === 'meta' ? await listMetaAccounts(source.tokens) : await listGoogleAccounts(connector, source.tokens)
  const chosen = accounts.find(account => account.id === accountId)
  if (!chosen) throw new ContentError('FORBIDDEN', { reason: '账户不在当前授权范围内' })
  if (connector === 'ga4') {
    const setup = await setupGa4(source.tokens, accountId)
    await writeConnection(context, connector, { measurementId: setup.measurementId }, setup.accountId, setup, source.revision)
  } else if (connector === 'googleAds') {
    const setup = await setupGoogleAds(source.tokens, accountId, source.scope.siteId)
    await writeConnection(context, connector, { conversionId: setup.conversionId, conversionLabel: setup.conversionLabel }, setup.accountId, setup, source.revision)
  } else if (connector === 'searchConsole') {
    const setup = await setupSearchConsole(source.tokens, accountId)
    await writeConnection(context, connector, { verificationMeta: setup.verificationMeta }, setup.accountId, setup, source.revision)
  } else await writeConnection(context, connector, { pixelId: accountId }, accountId, { pixelId: accountId, adAccountId: chosen.metadata?.adAccountId }, source.revision)
}

export async function disconnectIntegration(context: ContentContext, connector: Connector, revision: string): Promise<void> {
  await withContentTransaction(context, true, async (client, backups) => {
    const scope = await scopeFor(context, client)
    const bytes = await context.workspace.readFile('source/publish-config.json')
    if (resourceRevision(bytes) !== revision) throw new ContentError('REVISION_CONFLICT')
    const config = JSON.parse(bytes.toString('utf8')) as PublishConfig
    delete (config.connectors as Record<string, unknown>)[connector]
    await client.query("UPDATE integration_connections SET status='disconnected',public_config='{}',account_config='{}',account_id=NULL,updated_at=NOW() WHERE scope_key=$1 AND connector=$2", [scope.key, connector])
    const provider = providerFor(connector)
    if (provider) {
      const related = connectors.filter(candidate => providerFor(candidate) === provider)
      const active = await client.query("SELECT 1 FROM integration_connections WHERE scope_key=$1 AND connector=ANY($2) AND status='connected'", [scope.key, related])
      if (!active.rowCount) await client.query('DELETE FROM integration_credentials WHERE scope_key=$1 AND provider=$2', [scope.key, provider])
    }
    await writeResource(context, backups, 'source/publish-config.json', Buffer.from(`${JSON.stringify(config, null, 2)}\n`))
  })
}

export type ConversionInput = { siteId: string; source: 'public' | 'preview'; eventId: string; inquiryId?: string | number; kind: 'submit' | 'qualified'; dateTime: string; consent: { advertising: boolean }; email?: string; phone?: string; sourceUrl?: string; clientIp?: string; clientUserAgent?: string; attribution?: Record<string, string> }

export async function dispatchConversion(input: ConversionInput, database: pg.Pool = pool): Promise<{ status: string; deliveries?: Array<Record<string, unknown>>; reason?: string }> {
  if (input.source === 'preview') return { status: 'blocked', reason: 'PREVIEW_EXTERNAL_SEND_DISABLED' }
  if (input.consent?.advertising !== true) return { status: 'blocked', reason: 'ADVERTISING_CONSENT_REQUIRED' }
  const connections = (await database.query("SELECT * FROM integration_connections WHERE scope_key=$1 AND connector=ANY($2) AND status='connected'", [`site:${input.siteId}`, input.kind === 'submit' ? ['googleAds', 'meta'] : ['googleAds']])).rows
  if (!connections.length) return { status: 'blocked', reason: 'NOT_CONNECTED' }
  const deliveries: Array<Record<string, unknown>> = []
  for (const connection of connections) {
    const client = await database.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`conversion:${input.siteId}:${connection.connector}:${input.eventId}:${input.kind}`])
      const existing = await client.query('SELECT * FROM conversion_deliveries WHERE site_id=$1 AND connector=$2 AND event_id=$3 AND kind=$4 FOR UPDATE', [input.siteId, connection.connector, input.eventId, input.kind])
      if (existing.rows[0]?.status === 'completed') { deliveries.push(existing.rows[0]); await client.query('COMMIT'); continue }
      const id = existing.rows[0]?.delivery_id ?? randomUUID()
      await client.query("INSERT INTO conversion_deliveries(delivery_id,site_id,inquiry_id,connector,event_id,kind,status,attempts) VALUES($1,$2,$3,$4,$5,$6,'sending',1) ON CONFLICT(site_id,connector,event_id,kind) DO UPDATE SET status='sending',attempts=conversion_deliveries.attempts+1,error=NULL,updated_at=NOW()", [id, input.siteId, input.inquiryId ?? null, connection.connector, input.eventId, input.kind])
      try {
        const provider = connection.connector === 'meta' ? 'meta' : 'google'
        requireProviderEnvironment(provider)
        const tokens = await tokensFor(client, { key: `site:${input.siteId}`, siteId: input.siteId, draftId: null }, provider)
        const config = connection.account_config as Record<string, string>
        const response = connection.connector === 'meta'
          ? await sendMetaConversion(tokens, { pixelId: config.pixelId, eventId: input.eventId, dateTime: input.dateTime, sourceUrl: input.sourceUrl ?? '', email: input.email, phone: input.phone, clientIp: input.clientIp, clientUserAgent: input.clientUserAgent, fbc: input.attribution?.fbc, fbp: input.attribution?.fbp, consent: true })
          : await sendGoogleConversion(tokens, { event: input.kind, action: input.kind === 'submit' ? config.submitAction : config.qualifiedAction, accountId: connection.account_id, eventId: input.eventId, dateTime: new Date(input.dateTime).toISOString().slice(0, 19).replace('T', ' ') + '+00:00', email: input.email, phone: input.phone, gclid: input.attribution?.gclid, gbraid: input.attribution?.gbraid, wbraid: input.attribution?.wbraid, consent: true })
        await client.query("UPDATE conversion_deliveries SET status='completed',response=$2,updated_at=NOW() WHERE delivery_id=$1", [id, response])
        deliveries.push({ deliveryId: id, connector: connection.connector, status: 'completed', response })
      } catch (error) {
        const message = error instanceof ConnectorConfigurationError ? error.message : error instanceof ContentError ? error.code : '第三方转化发送失败，请检查连接器授权和平台诊断'
        await client.query("UPDATE conversion_deliveries SET status='failed',error=$2,updated_at=NOW() WHERE delivery_id=$1", [id, message])
        deliveries.push({ deliveryId: id, connector: connection.connector, status: 'failed', error: message })
      }
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  return { status: deliveries.some(item => item.status === 'failed') ? 'failed' : 'completed', deliveries }
}

export async function syncMarketingMetrics(context: ContentContext, connector: GoogleConnector | 'meta', date: string, environment: Environment = process.env): Promise<void> {
  const provider = providerFor(connector)!
  requireProviderEnvironment(provider, environment)
  const client = await context.database.connect()
  try {
    await client.query('BEGIN')
    const scope = await scopeFor(context, client)
    const connection = (await client.query("SELECT * FROM integration_connections WHERE scope_key=$1 AND connector=$2 AND status='connected'", [scope.key, connector])).rows[0]
    if (!connection?.account_id) throw new ContentError('NOT_CONNECTED')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`metrics:${scope.key}:${connector}:${date}`])
    const tokens = await tokensFor(client, scope, provider)
    const data = connector === 'meta' ? await readMetaDailyMetrics(tokens, connection.account_config.adAccountId, date, environment) : await readGoogleDailyMetrics(connector, tokens, connection.account_id, date, environment)
    await client.query('INSERT INTO marketing_metrics(scope_key,site_id,connector,date,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(scope_key,connector,date) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()', [scope.key, scope.siteId, connector, date, data])
    await client.query('UPDATE integration_connections SET last_synced_at=NOW(),last_error=NULL WHERE scope_key=$1 AND connector=$2', [scope.key, connector])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function promoteIntegrationScope(draftId: string, siteId: string, database: pg.Pool = pool): Promise<void> {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`integrations:${siteId}`])
    const from = `draft:${draftId}`
    const to = `site:${siteId}`
    for (const row of (await client.query('SELECT * FROM integration_credentials WHERE scope_key=$1 AND site_id=$2', [from, siteId])).rows) {
      const plaintext = decryptCredential(row.ciphertext, `${from}/${row.provider}`)
      await client.query('INSERT INTO integration_credentials(scope_key,site_id,draft_id,provider,ciphertext) VALUES($1,$2,NULL,$3,$4) ON CONFLICT(scope_key,provider) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=NOW()', [to, siteId, row.provider, encryptCredential(plaintext, `${to}/${row.provider}`)])
    }
    await client.query('INSERT INTO integration_connections(scope_key,site_id,draft_id,connector,status,account_id,account_config,public_config,last_synced_at,last_error) SELECT $2,site_id,NULL,connector,status,account_id,account_config,public_config,last_synced_at,last_error FROM integration_connections WHERE scope_key=$1 AND site_id=$3 ON CONFLICT(scope_key,connector) DO UPDATE SET status=EXCLUDED.status,account_id=EXCLUDED.account_id,account_config=EXCLUDED.account_config,public_config=EXCLUDED.public_config,updated_at=NOW()', [from, to, siteId])
    await client.query('DELETE FROM integration_credentials WHERE scope_key=$1', [from])
    await client.query('DELETE FROM integration_connections WHERE scope_key=$1', [from])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function notifySearchConsole(siteId: string, publicUrl: string, database: pg.Pool = pool): Promise<{ verificationId: string; status: number }> {
  const client = await database.connect()
  try {
    const scope = { key: `site:${siteId}`, siteId, draftId: null }
    const connection = (await client.query("SELECT * FROM integration_connections WHERE scope_key=$1 AND connector='searchConsole' AND status='connected'", [scope.key])).rows[0]
    if (!connection?.account_id) throw new ContentError('NOT_CONNECTED')
    if (new URL(publicUrl).origin !== new URL(connection.account_id).origin) throw new ContentError('VALIDATION_FAILED', { reason: '发布地址与Search Console网站不一致' })
    const tokens = await tokensFor(client, scope, 'google')
    return verifySearchConsole(tokens, connection.account_id, process.env, publicUrl)
  } finally { client.release() }
}

function integrationError(error: unknown, c: Context): Response {
  if (error instanceof ConnectorConfigurationError) return c.json({ error: error.message, code: 'CONNECTOR_NOT_CONFIGURED', variables: error.variables }, 503)
  if (error instanceof ConnectorRequestError) return c.json({ error: '第三方接口调用失败，请检查授权和平台诊断', code: 'CONNECTOR_REQUEST_FAILED', provider: error.provider, operation: error.operation }, 502)
  if (error instanceof ContentError && error.code === 'OAUTH_STATE_INVALID') return c.json({ error: '授权请求无效或已过期', code: error.code }, 400)
  return resourceErrorResponse(error, c)
}

export const integrationRoutes = new Hono<{ Variables: AuthVariables }>()
integrationRoutes.use('/drafts/:draftId/integrations', requireAuth)
integrationRoutes.use('/drafts/:draftId/integrations/*', requireAuth)
integrationRoutes.get('/drafts/:draftId/integrations', async c => {
  try {
    const context = await managedResourceContext(c)
    return c.json({ integrations: await listIntegrations(context), revision: resourceRevision(await context.workspace.readFile('source/publish-config.json')) })
  } catch (error) { return integrationError(error, c) }
})
integrationRoutes.post('/drafts/:draftId/integrations/oauth/:provider', async c => {
  try {
    const provider = z.enum(['google', 'meta']).parse(c.req.param('provider'))
    const session = await resolveSessionFromToken(c.get('accessToken'))
    if (!session) throw new ContentError('FORBIDDEN')
    return c.json(await beginOAuth(await managedResourceContext(c), session.sessionId, provider))
  } catch (error) { return integrationError(error, c) }
})
export async function handleOAuthCallback(c:Context,database:pg.Pool=pool,adminBase:string=process.env.ADMIN_PUBLIC_BASE_URL??'http://127.0.0.1:5173'):Promise<Response> {
  try {
    const destination=new URL(adminBase)
    if(!['http:','https:'].includes(destination.protocol)||destination.username||destination.password||destination.search||destination.hash)throw new Error('ADMIN_PUBLIC_BASE_URL 必须是有效的后台 HTTP(S) 地址')
    destination.pathname=`${destination.pathname.replace(/\/$/,'')}/integrations`
    const provider = z.enum(['google', 'meta']).parse(c.req.param('provider'))
    const state = z.string().min(40).max(200).parse(c.req.query('state'))
    const cancelled=Boolean(c.req.query('error'))
    const result=cancelled?await consumeOAuthState(state,provider,database):await completeOAuth(provider,state,z.string().min(1).max(10000).parse(c.req.query('code')),database)
    destination.searchParams.set(cancelled?'cancelled':'connected','1')
    destination.searchParams.set('siteId',result.siteId)
    destination.searchParams.set('draftId',result.draftId)
    return c.redirect(destination.href,303)
  } catch (error) { return integrationError(error, c) }
}
integrationRoutes.get('/integrations/oauth/:provider/callback',c=>handleOAuthCallback(c))
integrationRoutes.get('/drafts/:draftId/integrations/:connector/accounts', async c => {
  try {
    const connector = z.enum(['ga4', 'googleAds', 'searchConsole', 'meta']).parse(c.req.param('connector'))
    return c.json({ accounts: await integrationAccounts(await managedResourceContext(c), connector) })
  } catch (error) { return integrationError(error, c) }
})
integrationRoutes.put('/drafts/:draftId/integrations/:connector', async c => {
  try {
    const context = await managedResourceContext(c)
    const connector = connectorSchema.parse(c.req.param('connector'))
    const revision = expectedRevision(c)
    if (providerFor(connector)) {
      const body = z.object({ accountId: z.string().min(1).max(1000) }).strict().parse(await c.req.json())
      await selectIntegrationAccount(context, connector as GoogleConnector | 'meta', body.accountId, revision)
    } else await configureIdConnector(context, connector as IdConnector, await c.req.json(), revision)
    return c.json({ integrations: await listIntegrations(context), revision: resourceRevision(await context.workspace.readFile('source/publish-config.json')) })
  } catch (error) { return integrationError(error, c) }
})
integrationRoutes.delete('/drafts/:draftId/integrations/:connector', async c => {
  try { await disconnectIntegration(await managedResourceContext(c), connectorSchema.parse(c.req.param('connector')), expectedRevision(c)); return c.body(null, 204) }
  catch (error) { return integrationError(error, c) }
})
integrationRoutes.post('/drafts/:draftId/integrations/:connector/metrics/sync', async c => {
  try {
    const connector = z.enum(['ga4', 'googleAds', 'searchConsole', 'meta']).parse(c.req.param('connector'))
    const body = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(await c.req.json())
    await syncMarketingMetrics(await managedResourceContext(c), connector, body.date)
    return c.json({ synchronized: true })
  } catch (error) { return integrationError(error, c) }
})

import type pg from 'pg'
import { ConnectorConfigurationError, ConnectorRequestError, readGoogleDailyMetrics, readMetaDailyMetrics, type OAuthTokens, type GoogleConnector } from '@olps/connectors'
import { decryptCredential } from './credentials.js'
import { pool } from './db.js'

export async function runDailyMarketingSync(database: pg.Pool = pool, now: Date = new Date()): Promise<Array<{ siteId: string; connector: string; status: string }>> {
  const date = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
  const connections = (await database.query("SELECT * FROM integration_connections c WHERE status='connected' AND scope_key='site:'||site_id AND connector=ANY($1) AND NOT EXISTS(SELECT 1 FROM marketing_metrics m WHERE m.scope_key=c.scope_key AND m.connector=c.connector AND m.date=$2)", [['ga4', 'googleAds', 'searchConsole', 'meta'], date])).rows
  const results: Array<{ siteId: string; connector: string; status: string }> = []
  for (const connection of connections) {
    const client = await database.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`metrics:${connection.scope_key}:${connection.connector}:${date}`])
      if ((await client.query('SELECT 1 FROM marketing_metrics WHERE scope_key=$1 AND connector=$2 AND date=$3', [connection.scope_key, connection.connector, date])).rowCount) { await client.query('COMMIT'); continue }
      const provider = connection.connector === 'meta' ? 'meta' : 'google'
      const credential = (await client.query('SELECT ciphertext FROM integration_credentials WHERE scope_key=$1 AND provider=$2', [connection.scope_key, provider])).rows[0]
      if (!credential) {
        await client.query("UPDATE integration_connections SET status='needs_reconnect',last_error='连接凭据不可用，请重新连接' WHERE scope_key=$1 AND connector=$2", [connection.scope_key, connection.connector])
        await client.query('COMMIT')
        results.push({ siteId: connection.site_id, connector: connection.connector, status: 'blocked' })
        continue
      }
      const tokens = JSON.parse(decryptCredential(credential.ciphertext, `${connection.scope_key}/${provider}`)) as OAuthTokens
      const metrics = connection.connector === 'meta'
        ? await readMetaDailyMetrics(tokens, connection.account_config.adAccountId, date)
        : await readGoogleDailyMetrics(connection.connector as GoogleConnector, tokens, connection.account_id, date)
      await client.query('INSERT INTO marketing_metrics(scope_key,site_id,connector,date,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(scope_key,connector,date) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()', [connection.scope_key, connection.site_id, connection.connector, date, metrics])
      await client.query('UPDATE integration_connections SET last_synced_at=NOW(),last_error=NULL WHERE scope_key=$1 AND connector=$2', [connection.scope_key, connection.connector])
      await client.query('COMMIT')
      results.push({ siteId: connection.site_id, connector: connection.connector, status: 'completed' })
    } catch (error) {
      await client.query('ROLLBACK')
      if (!(error instanceof ConnectorConfigurationError || error instanceof ConnectorRequestError)) throw error
      const message = error instanceof ConnectorConfigurationError ? error.message : '第三方指标同步失败，请检查授权和平台诊断'
      const reconnect = error instanceof ConnectorRequestError && (error.status === 401 || ['invalid_grant', '190'].includes(error.providerCode ?? ''))
      await database.query('UPDATE integration_connections SET last_error=$3,status=CASE WHEN $4 THEN \'needs_reconnect\' ELSE status END WHERE scope_key=$1 AND connector=$2', [connection.scope_key, connection.connector, message, reconnect])
      results.push({ siteId: connection.site_id, connector: connection.connector, status: error instanceof ConnectorConfigurationError ? 'blocked' : 'failed' })
    } finally { client.release() }
  }
  return results
}

export function startDailyMarketingSync(database: pg.Pool = pool): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try { await runDailyMarketingSync(database) } finally { running = false }
  }
  const timer = setInterval(() => { void tick() }, 60_000)
  timer.unref()
  void tick()
  return () => clearInterval(timer)
}

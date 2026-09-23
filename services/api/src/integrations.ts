import { pool } from './db.js'

export type SiteIntegrations = {
  siteId: string
  tenantId: string
  adsAccountId: string
  adsConnected: boolean
  gaPropertyId: string
  gaConnected: boolean
  updatedAt: string
}

export async function getIntegrations(
  tenantId: string,
  siteId: string,
): Promise<SiteIntegrations> {
  const result = await pool.query(
    `SELECT * FROM site_integrations WHERE tenant_id=$1 AND site_id=$2`,
    [tenantId, siteId],
  )
  if (!result.rowCount) {
    return {
      siteId,
      tenantId,
      adsAccountId: '',
      adsConnected: false,
      gaPropertyId: '',
      gaConnected: false,
      updatedAt: new Date(0).toISOString(),
    }
  }
  return map(result.rows[0]!)
}

export async function upsertIntegrations(
  tenantId: string,
  siteId: string,
  patch: Partial<{
    adsAccountId: string
    adsConnected: boolean
    gaPropertyId: string
    gaConnected: boolean
  }>,
): Promise<SiteIntegrations> {
  const current = await getIntegrations(tenantId, siteId)
  const next = {
    adsAccountId: patch.adsAccountId ?? current.adsAccountId,
    adsConnected: patch.adsConnected ?? current.adsConnected,
    gaPropertyId: patch.gaPropertyId ?? current.gaPropertyId,
    gaConnected: patch.gaConnected ?? current.gaConnected,
  }
  if (next.adsConnected && !next.adsAccountId.trim()) {
    throw new Error('连接 Ads 时必须填写 adsAccountId')
  }
  if (next.gaConnected && !next.gaPropertyId.trim()) {
    throw new Error('连接 GA 时必须填写 gaPropertyId')
  }
  const now = new Date().toISOString()
  await pool.query(
    `INSERT INTO site_integrations(site_id, tenant_id, ads_account_id, ads_connected, ga_property_id, ga_connected, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (site_id) DO UPDATE SET
       ads_account_id=EXCLUDED.ads_account_id,
       ads_connected=EXCLUDED.ads_connected,
       ga_property_id=EXCLUDED.ga_property_id,
       ga_connected=EXCLUDED.ga_connected,
       updated_at=EXCLUDED.updated_at`,
    [
      siteId,
      tenantId,
      next.adsAccountId,
      next.adsConnected,
      next.gaPropertyId,
      next.gaConnected,
      now,
    ],
  )
  return getIntegrations(tenantId, siteId)
}

function map(row: Record<string, unknown>): SiteIntegrations {
  return {
    siteId: String(row.site_id),
    tenantId: String(row.tenant_id),
    adsAccountId: String(row.ads_account_id ?? ''),
    adsConnected: Boolean(row.ads_connected),
    gaPropertyId: String(row.ga_property_id ?? ''),
    gaConnected: Boolean(row.ga_connected),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
loadEnv({ path: path.join(root, '.env') })

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value?.trim()) {
    throw new Error(`缺少环境变量 ${name}`)
  }
  return value.trim()
}

export const appConfig = {
  root,
  databaseUrl: requireEnv('DATABASE_URL'),
  port: Number(process.env.PORT ?? '8787'),
  publishRoot: path.resolve(root, process.env.PUBLISH_ROOT ?? '.publish'),
  previewRoot: path.resolve(root, process.env.PREVIEW_ROOT ?? '.preview'),
  ssoAuthority: requireEnv('SSO_AUTHORITY'),
  ssoPasswordClientId: process.env.SSO_PASSWORD_CLIENT_ID?.trim() || 'cso_client',
  ssoPasswordClientSecret: process.env.SSO_PASSWORD_CLIENT_SECRET?.trim() || '',
  ssoPasswordScope:
    process.env.SSO_PASSWORD_SCOPE?.trim() ||
    'openid api-tso api-aisites api-google cutapi.rw',
  siteApiInternalBaseUrl: (
    process.env.SITE_API_INTERNAL_BASE_URL?.trim() ||
    'https://ai-sites-api-ci.siluzan.com'
  ).replace(/\/+$/, ''),
  siteApiRequestTimeoutMs: (() => {
    const raw = process.env.SITE_API_REQUEST_TIMEOUT_MS?.trim()
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000
  })(),
  defaultScreenCap: Number(process.env.OLPS_DEFAULT_SCREEN_CAP ?? '20'),
}

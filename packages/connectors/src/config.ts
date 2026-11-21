export type Provider = 'google' | 'meta'
export type Environment = Record<string, string | undefined>
export class ConnectorConfigurationError extends Error {
  constructor(readonly variables: string[]) { super(`缺少环境变量 ${variables.join('、')}`) }
}

const requiredVariables = {
  google: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'OAUTH_REDIRECT_BASE_URL'],
  meta: ['META_APP_ID', 'META_APP_SECRET', 'OAUTH_REDIRECT_BASE_URL'],
} as const

export function missingProviderEnvironment(provider: Provider, environment: Environment = process.env): string[] {
  return requiredVariables[provider].filter(name => !environment[name]?.trim())
}

export function requireProviderEnvironment(provider: Provider, environment: Environment = process.env): Environment {
  const missing = missingProviderEnvironment(provider, environment)
  if (missing.length) throw new ConnectorConfigurationError(missing)
  const callback = new URL(environment.OAUTH_REDIRECT_BASE_URL!)
  if (callback.protocol !== 'https:' && !(callback.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname))) throw new Error('OAuth回调地址必须使用HTTPS或本机HTTP地址')
  return environment
}

export function requireEnvironmentValue(name: string, environment: Environment = process.env): string {
  const value = environment[name]?.trim()
  if (!value) throw new ConnectorConfigurationError([name])
  return value
}

export function oauthRedirect(provider: Provider, environment: Environment = process.env): string {
  requireProviderEnvironment(provider, environment)
  return `${environment.OAUTH_REDIRECT_BASE_URL!.replace(/\/$/, '')}/api/integrations/oauth/${provider}/callback`
}

export type IdConnector = 'gtm' | 'tiktok' | 'linkedin' | 'clarity' | 'uet'
const idFields: Record<IdConnector, Record<string, { pattern: RegExp; optional?: boolean }>> = {
  gtm: { containerId: { pattern: /^GTM-[A-Z0-9]+$/ } },
  tiktok: { pixelId: { pattern: /^[A-Za-z0-9]+$/ } },
  linkedin: { partnerId: { pattern: /^\d+$/ }, conversionId: { pattern: /^\d+$/, optional: true } },
  clarity: { projectId: { pattern: /^[a-zA-Z0-9]+$/ } },
  uet: { tagId: { pattern: /^\d+$/ } },
}

export function validatePublicConnector(id: IdConnector, input: unknown): Record<string, string> {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('连接器公开ID无效')
  const fields = idFields[id]
  if (!fields) throw new Error('连接器类型无效')
  const values = input as Record<string, unknown>
  if (Object.keys(values).some(key => !Object.prototype.hasOwnProperty.call(fields, key))) throw new Error('连接器包含不允许的字段')
  const output: Record<string, string> = {}
  for (const [key, config] of Object.entries(fields)) {
    const value = values[key]
    if (value === undefined && config.optional) continue
    if (typeof value !== 'string' || !config.pattern.test(value) || value.length > 200) throw new Error(`连接器公开ID无效：${key}`)
    output[key] = value
  }
  return output
}

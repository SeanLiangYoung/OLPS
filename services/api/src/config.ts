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
  publishRoot: path.resolve(
    root,
    process.env.PUBLISH_ROOT ?? path.join('.intermediate', 'publish'),
  ),
  previewRoot: path.resolve(
    root,
    process.env.PREVIEW_ROOT ?? path.join('.intermediate', 'preview'),
  ),
  sandboxRoot: path.resolve(
    root,
    process.env.SANDBOX_ROOT ?? path.join('.intermediate', 'sandboxes'),
  ),
  get remoteServiceUrl(): string {
    return process.env.REMOTE_SERVICE_URL?.trim().replace(/\/+$/, '') || ''
  },
  get remoteServiceToken(): string {
    return process.env.REMOTE_SERVICE_TOKEN?.trim() || ''
  },
  get knowledgeServiceUrl(): string {
    return process.env.KNOWLEDGE_SERVICE_URL?.trim().replace(/\/+$/, '') || ''
  },
  get knowledgeServiceToken(): string {
    return process.env.KNOWLEDGE_SERVICE_TOKEN?.trim() || ''
  },
  sessionTtlHours: (() => {
    const parsed = Number(process.env.SESSION_TTL_HOURS ?? '168')
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 168
  })(),
  get previewCredentialTtlSeconds(): number {
    const parsed = Number(process.env.PREVIEW_CREDENTIAL_TTL_SECONDS ?? '900')
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 900
  },
  get editorResourceTtlSeconds():number {
    const value=Number(process.env.EDITOR_RESOURCE_TTL_SECONDS??'900')
    if(!Number.isInteger(value)||value<1||value>86400)throw new Error('EDITOR_RESOURCE_TTL_SECONDS必须是1至86400之间的整数')
    return value
  },
  cursorAgentCommand: process.env.CURSOR_AGENT_COMMAND?.trim() || 'cursor-agent',
  get aiBaseUrl(): string {
    return process.env.AI_BASE_URL?.trim() || 'https://api.deepseek.com'
  },
  get aiModel(): string {
    return process.env.AI_MODEL?.trim() || 'deepseek-v4-pro'
  },
  get aiApiKey(): string {
    return requireEnv('AI_API_KEY')
  },
  get publicApiBaseUrl(): string {
    return (
      process.env.PUBLIC_API_BASE_URL?.trim() ||
      `http://127.0.0.1:${Number(process.env.PORT ?? '8787')}`
    ).replace(/\/+$/, '')
  },
}

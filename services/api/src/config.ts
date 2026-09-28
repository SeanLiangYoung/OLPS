import fs from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { vitestRemoteEnvFile } from './test-support/vitest-remote-env-path.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
loadEnv({ path: path.join(root, '.env') })

if (fs.existsSync(vitestRemoteEnvFile)) {
  const vitestEnv = JSON.parse(fs.readFileSync(vitestRemoteEnvFile, 'utf8')) as {
    REMOTE_SERVICE_URL?: string
    REMOTE_SERVICE_TOKEN?: string
  }
  if (vitestEnv.REMOTE_SERVICE_URL) {
    process.env.REMOTE_SERVICE_URL = vitestEnv.REMOTE_SERVICE_URL
  }
  if (vitestEnv.REMOTE_SERVICE_TOKEN) {
    process.env.REMOTE_SERVICE_TOKEN = vitestEnv.REMOTE_SERVICE_TOKEN
  }
}

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
  sessionTtlHours: (() => {
    const parsed = Number(process.env.SESSION_TTL_HOURS ?? '168')
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 168
  })(),
  defaultScreenCap: Number(process.env.OLPS_DEFAULT_SCREEN_CAP ?? '20'),
  cursorAgentCommand: process.env.CURSOR_AGENT_COMMAND?.trim() || 'cursor-agent',
  get publicApiBaseUrl(): string {
    return (
      process.env.PUBLIC_API_BASE_URL?.trim() ||
      `http://127.0.0.1:${Number(process.env.PORT ?? '8787')}`
    ).replace(/\/+$/, '')
  },
}

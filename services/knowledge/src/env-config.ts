import type { KnowledgeServiceConfig } from './types.js'

const DEFAULT_IMPORT_MAX_BYTES = 104_857_600
const DEFAULT_SINGLE_FILE_MAX_BYTES = 20_971_520
const DEFAULT_LISTEN_PORT = 19_828

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return fallback
  }
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`环境变量数值无效: ${trimmed}`)
  }
  return value
}

export function readKnowledgeListenPort(env: NodeJS.ProcessEnv): number {
  const raw = env.KNOWLEDGE_PORT?.trim()
  if (raw) {
    return readPositiveInt(raw, DEFAULT_LISTEN_PORT)
  }
  return DEFAULT_LISTEN_PORT
}

export function readKnowledgeImportMaxBytes(env: NodeJS.ProcessEnv): number {
  return readPositiveInt(env.KNOWLEDGE_IMPORT_MAX_BYTES, DEFAULT_IMPORT_MAX_BYTES)
}

/** 单文件上限，默认与 API 侧 MEDIA_MAX_BYTES 相同（20MB）。 */
export function readKnowledgeSingleFileMaxBytes(env: NodeJS.ProcessEnv): number {
  return readPositiveInt(env.MEDIA_MAX_BYTES, DEFAULT_SINGLE_FILE_MAX_BYTES)
}

export function loadKnowledgeServiceConfig(env: NodeJS.ProcessEnv): KnowledgeServiceConfig {
  const serviceToken = env.KNOWLEDGE_SERVICE_TOKEN?.trim() ?? ''
  if (!serviceToken) {
    throw new Error('必须设置非空环境变量 KNOWLEDGE_SERVICE_TOKEN')
  }
  const knowledgeRoot = env.KNOWLEDGE_ROOT?.trim() || '.intermediate/knowledge-data'
  const databaseUrl = env.DATABASE_URL?.trim() || undefined
  return {
    knowledgeRoot,
    serviceToken,
    importMaxBytes: readKnowledgeImportMaxBytes(env),
    singleFileMaxBytes: readKnowledgeSingleFileMaxBytes(env),
    databaseUrl,
    listenPort: readKnowledgeListenPort(env),
    listenHost: env.KNOWLEDGE_HOST?.trim() || '127.0.0.1',
  }
}
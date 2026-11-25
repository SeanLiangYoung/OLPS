import path from 'node:path'
import { knowledgeRepoRoot } from './repo-root.js'
import type { KnowledgeServiceConfig } from './types.js'

/** 单次导入合计默认 16GB */
const DEFAULT_IMPORT_MAX_BYTES = 16 * 1024 * 1024 * 1024
/** 单文件默认 2GB（与媒体库 MEDIA_MAX_BYTES 脱钩） */
const DEFAULT_IMPORT_FILE_MAX_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
const DEFAULT_LISTEN_PORT = 19_828
const DEFAULT_KNOWLEDGE_ROOT = '.intermediate/knowledge-data'

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

/** 知识库导入单文件上限；优先 KNOWLEDGE_IMPORT_FILE_MAX_BYTES。 */
export function readKnowledgeSingleFileMaxBytes(env: NodeJS.ProcessEnv): number {
  const dedicated = env.KNOWLEDGE_IMPORT_FILE_MAX_BYTES?.trim()
  if (dedicated) {
    return readPositiveInt(dedicated, DEFAULT_IMPORT_FILE_MAX_BYTES)
  }
  return DEFAULT_IMPORT_FILE_MAX_BYTES
}

export function readKnowledgeUploadChunkBytes(env: NodeJS.ProcessEnv): number {
  return readPositiveInt(env.KNOWLEDGE_UPLOAD_CHUNK_BYTES, DEFAULT_UPLOAD_CHUNK_BYTES)
}

export function resolveKnowledgeRoot(raw: string | undefined, repoRoot = knowledgeRepoRoot): string {
  const trimmed = raw?.trim() || DEFAULT_KNOWLEDGE_ROOT
  if (path.isAbsolute(trimmed)) {
    return trimmed
  }
  return path.resolve(repoRoot, trimmed)
}

export function loadKnowledgeServiceConfig(env: NodeJS.ProcessEnv): KnowledgeServiceConfig {
  const serviceToken = env.KNOWLEDGE_SERVICE_TOKEN?.trim() ?? ''
  if (!serviceToken) {
    throw new Error('必须设置非空环境变量 KNOWLEDGE_SERVICE_TOKEN')
  }
  const knowledgeRoot = resolveKnowledgeRoot(env.KNOWLEDGE_ROOT)
  const databaseUrl = env.DATABASE_URL?.trim() || undefined
  return {
    knowledgeRoot,
    serviceToken,
    importMaxBytes: readKnowledgeImportMaxBytes(env),
    singleFileMaxBytes: readKnowledgeSingleFileMaxBytes(env),
    uploadChunkBytes: readKnowledgeUploadChunkBytes(env),
    databaseUrl,
    listenPort: readKnowledgeListenPort(env),
    listenHost: env.KNOWLEDGE_HOST?.trim() || '127.0.0.1',
  }
}

import fs from 'node:fs/promises'
import path from 'node:path'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import type { AddressInfo } from 'node:net'
import { createKnowledgeApp } from './app.js'
import type { KnowledgeServiceConfig } from './types.js'

const DEFAULT_TEST_LIMITS = {
  importMaxBytes: 104_857_600,
  singleFileMaxBytes: 20_971_520,
  uploadChunkBytes: 8_388_608,
} as const

export async function makeIsolatedKnowledgeRoot(label: string): Promise<string> {
  const root = path.resolve(process.cwd(), '.intermediate', `${label}-${Date.now().toString(36)}`)
  await fs.mkdir(root, { recursive: true })
  return root
}

export async function startKnowledgeServer(
  config: Pick<KnowledgeServiceConfig, 'knowledgeRoot' | 'serviceToken'> &
    Partial<Pick<KnowledgeServiceConfig, 'importMaxBytes' | 'singleFileMaxBytes' | 'uploadChunkBytes' | 'databaseUrl'>> & {
      /** 默认关闭 Ingest，避免无 AI 密钥时拖垮 W2 导入用例；W3 Ingest 用例显式打开 */
      enableIngest?: boolean
    },
): Promise<{
  baseUrl: string
  close: () => void
}> {
  const previousDisable = process.env.KNOWLEDGE_DISABLE_INGEST
  if (config.enableIngest) {
    delete process.env.KNOWLEDGE_DISABLE_INGEST
  } else {
    process.env.KNOWLEDGE_DISABLE_INGEST = '1'
  }
  const holder: { app: Hono | null } = { app: null }
  const fullConfig: KnowledgeServiceConfig = {
    knowledgeRoot: config.knowledgeRoot,
    serviceToken: config.serviceToken,
    importMaxBytes: config.importMaxBytes ?? DEFAULT_TEST_LIMITS.importMaxBytes,
    singleFileMaxBytes: config.singleFileMaxBytes ?? DEFAULT_TEST_LIMITS.singleFileMaxBytes,
    uploadChunkBytes: config.uploadChunkBytes ?? DEFAULT_TEST_LIMITS.uploadChunkBytes,
    databaseUrl: config.databaseUrl,
  }
  const server = serve({
    fetch: (req) => {
      if (!holder.app) {
        return new Response('not ready', { status: 503 })
      }
      return holder.app.fetch(req)
    },
    port: 0,
  })
  await new Promise<void>((resolve) => {
    server.on('listening', () => resolve())
  })
  const addr = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${addr.port}`
  holder.app = createKnowledgeApp(fullConfig)
  return {
    baseUrl,
    close: () => {
      if (previousDisable === undefined) {
        delete process.env.KNOWLEDGE_DISABLE_INGEST
      } else {
        process.env.KNOWLEDGE_DISABLE_INGEST = previousDisable
      }
      server.close()
    },
  }
}
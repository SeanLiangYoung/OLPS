import pg from 'pg'
import { resolveKnowledgePgSchemaAsync, withPgSearchPath } from './pg-search-path.js'

let sharedPool: pg.Pool | null = null
let sharedPoolKey: string | undefined

function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`非法 schema 名称: ${name}`)
  }
  return `"${name}"`
}

export function getKnowledgeProjectionPool(databaseUrl: string, schema?: string): pg.Pool {
  const key = `${databaseUrl}\0${schema ?? ''}`
  if (sharedPool && sharedPoolKey === key) {
    return sharedPool
  }
  if (sharedPool) {
    void sharedPool.end()
  }
  sharedPoolKey = key
  sharedPool = new pg.Pool({
    connectionString: databaseUrl,
    ...(schema ? { options: `-c search_path=${quoteIdent(schema)}` } : {}),
  })
  return sharedPool
}

export async function withKnowledgeProjectionClient<T>(
  databaseUrl: string,
  env: NodeJS.ProcessEnv,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const schema = await resolveKnowledgePgSchemaAsync(env)
  const pool = getKnowledgeProjectionPool(databaseUrl, schema)
  const client = await pool.connect()
  try {
    return await withPgSearchPath(client, schema, () => work(client))
  } finally {
    client.release()
  }
}
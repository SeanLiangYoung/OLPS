import fs from 'node:fs/promises'
import path from 'node:path'
import type pg from 'pg'

function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`非法 schema 名称: ${name}`)
  }
  return `"${name}"`
}

export async function readKnowledgePgSchemaFromFile(filePath: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const schema = raw.trim()
    if (!schema) {
      return undefined
    }
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
      throw new Error(`schema 文件内容非法: ${schema}`)
    }
    return schema
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return undefined
    }
    throw err
  }
}

export function knowledgePgSchemaFilePath(env: NodeJS.ProcessEnv): string {
  const configured = env.KNOWLEDGE_PG_SCHEMA_FILE?.trim()
  if (configured) {
    return path.resolve(configured)
  }
  const root = env.KNOWLEDGE_ROOT?.trim() || '.intermediate/knowledge-data'
  const resolvedRoot = path.resolve(root)
  const worktreeGuess = path.resolve(resolvedRoot, '..', '..')
  return path.join(worktreeGuess, '.intermediate', 'knowledge-projection-pg-schema')
}

export async function resolveKnowledgePgSchemaAsync(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const fromEnv = env.KNOWLEDGE_PG_SCHEMA?.trim()
  if (fromEnv) {
    return fromEnv
  }
  return readKnowledgePgSchemaFromFile(knowledgePgSchemaFilePath(env))
}

export async function withPgSearchPath<T>(
  client: pg.PoolClient,
  schema: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (!schema) {
    return work()
  }
  await client.query(`SET search_path TO ${quoteIdent(schema)}`)
  return work()
}
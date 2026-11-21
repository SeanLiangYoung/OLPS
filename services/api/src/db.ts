import pg from 'pg'
import { appConfig } from './config.js'

let poolInstance: pg.Pool | null = null

function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`非法 schema 名称: ${name}`)
  }
  return `"${name}"`
}

function createPool(): pg.Pool {
  const schema = process.env.PG_TEST_SCHEMA
  return new pg.Pool({
    connectionString: appConfig.databaseUrl,
    ...(schema ? { options: `-c search_path=${quoteIdent(schema)}` } : {}),
  })
}

export function recreatePool(): void {
  poolInstance = createPool()
}

export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop, receiver) {
    if (!poolInstance) {
      poolInstance = createPool()
    }
    const value = Reflect.get(poolInstance, prop, poolInstance)
    return typeof value === 'function' ? value.bind(poolInstance) : value
  },
})

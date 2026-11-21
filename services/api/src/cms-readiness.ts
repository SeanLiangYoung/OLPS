import type pg from 'pg'

export const cmsUpgradeVersion=1

export async function cmsUpgradeCompleted(database:pg.Pool):Promise<boolean>{
  const table=await database.query("SELECT to_regclass('cms_upgrade_state') AS name")
  if(!table.rows[0].name)return false
  const state=await database.query('SELECT version,status FROM cms_upgrade_state WHERE singleton=TRUE')
  return state.rows[0]?.version===cmsUpgradeVersion&&state.rows[0]?.status==='completed'
}

export async function assertCmsReady(database:pg.Pool):Promise<void>{
  if(!await cmsUpgradeCompleted(database))throw new Error('数据库升级尚未完成，请停止 API 后执行 npm run upgrade -w @olps/api')
}

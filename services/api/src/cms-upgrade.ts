import type pg from 'pg'
import { migrateWithClient } from './db-schema.js'
import { legacySitesHaveTenantId,migrateToCollaborationModel } from './migrate.js'
import { migrateCmsRuntime } from './cms-runtime-schema.js'
import { cmsUpgradeCompleted,cmsUpgradeVersion } from './cms-readiness.js'
import { assertCredentialsKey } from './credentials.js'

export async function upgradeCms(database:pg.Pool,options:Parameters<typeof migrateCmsRuntime>[1]={}):Promise<void>{
  assertCredentialsKey()
  const lock=await database.connect()
  let locked=false
  try{
    locked=Boolean((await lock.query("SELECT pg_try_advisory_lock(hashtext('olps-cms-upgrade')) AS acquired")).rows[0].acquired)
    if(!locked)throw new Error('网站升级命令正在运行，请等待其完成')
    if(await cmsUpgradeCompleted(database))return
    await lock.query("CREATE TABLE IF NOT EXISTS cms_upgrade_state(singleton BOOLEAN PRIMARY KEY CHECK(singleton),version INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('running','completed')),completed_at TIMESTAMPTZ)")
    const existing=await lock.query('SELECT version FROM cms_upgrade_state WHERE singleton=TRUE')
    if(existing.rows[0]?.version>cmsUpgradeVersion)throw new Error('数据库版本高于当前程序版本，请使用对应版本的升级命令')
    await lock.query("INSERT INTO cms_upgrade_state(singleton,version,status) VALUES(TRUE,$1,'running') ON CONFLICT(singleton) DO UPDATE SET version=EXCLUDED.version,status='running',completed_at=NULL",[cmsUpgradeVersion])
    if(await legacySitesHaveTenantId(database))await migrateToCollaborationModel(database,{sandboxRoot:options.sandboxRoot})
    else{
      const client=await database.connect()
      try{await migrateWithClient(client)}finally{client.release()}
    }
    await migrateCmsRuntime(database,options)
    await lock.query("UPDATE cms_upgrade_state SET status='completed',completed_at=NOW() WHERE singleton=TRUE AND version=$1",[cmsUpgradeVersion])
  }finally{
    try{if(locked)await lock.query("SELECT pg_advisory_unlock(hashtext('olps-cms-upgrade'))")}finally{lock.release()}
  }
}

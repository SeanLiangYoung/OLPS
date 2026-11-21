import { randomUUID,randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { afterAll,beforeEach,describe,expect,it } from 'vitest'
import { app } from './app.js'
import { pool as appPool } from './db.js'
import { legacySitesHaveTenantId,migrateToCollaborationModel } from './migrate.js'
import { createFullLegacyTenantSchema,LEGACY_SETTINGS_JSON } from './test-support/legacy-schema.js'
import { createTestPool,getTestDatabaseUrl,resetTestDatabase } from './test-support/reset-test-db.js'
import { resetTestSandboxes } from './test-support/reset-test-sandboxes.js'
import { requestJson } from './test-support/http.js'
import { hashPassword } from './password.js'

const database=createTestPool()
const packageRoot=path.resolve(import.meta.dirname,'..')
afterAll(()=>database.end())
beforeEach(async()=>{
  delete process.env.MIGRATION_SITE_OWNERS;delete process.env.MIGRATION_KB_OWNERS;delete process.env.MIGRATION_BOOTSTRAP_USERS
  await resetTestDatabase();await resetTestSandboxes()
},120000)

async function preparePages():Promise<void>{
  for(const row of (await database.query('SELECT page_id FROM pages')).rows){
    const id=randomUUID()
    for(const table of ['pages','inquiries','reports','analytics_events'])await database.query(`UPDATE ${table} SET page_id=$1 WHERE page_id=$2`,[id,row.page_id])
  }
}
function owners():void{process.env.MIGRATION_SITE_OWNERS=JSON.stringify({'legacy-site-1':['seanliang']});process.env.MIGRATION_KB_OWNERS=JSON.stringify({'legacy-kb-1':['seanliang']})}
async function seedUsers():Promise<void>{
  await database.query('CREATE TABLE users(user_id TEXT PRIMARY KEY,account TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,name TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL)')
  await database.query("INSERT INTO users VALUES('user-sean','seanliang',$1,'Sean',NOW(),NOW())",[hashPassword('MigrationPass123!')])
}
async function clientsFrom(pool:pg.Pool,action:(clients:pg.PoolClient[])=>Promise<void>):Promise<void>{
  const clients=await Promise.all([pool.connect(),pool.connect(),pool.connect()])
  try{await action(clients)}finally{clients.forEach(client=>client.release())}
}
async function checkClients(clients:pg.PoolClient[],schema:string,marker?:string):Promise<void>{
  const rows=await Promise.all(clients.map(async client=>(await client.query('SELECT pg_backend_pid() AS pid,current_schema() AS schema')).rows[0]))
  expect(new Set(rows.map(row=>row.pid)).size).toBe(3)
  expect(rows.map(row=>row.schema)).toEqual([schema,schema,schema])
  if(marker)for(const client of clients){expect((await client.query('SELECT site_id FROM sites WHERE site_id=$1',[marker])).rowCount).toBe(1);expect((await client.query("SELECT site_id FROM sites WHERE site_id='legacy-site-1'")).rowCount).toBe(0)}
}

describe('迁移环境与连接池',()=>{
  it('测试连接池同时借出的三个连接具有独立进程并使用当前schema',async()=>{
    await createFullLegacyTenantSchema(database)
    await clientsFrom(database,async clients=>{await checkClients(clients,process.env.PG_TEST_SCHEMA!);expect((await clients[0].query("SELECT site_id FROM sites WHERE site_id='legacy-site-1'")).rowCount).toBe(1)})
  })
  for(const [name,pool]of [['test',database],['app',appPool]] as const)it(`${name}连接池已有连接在切换schema后读取新schema`,async()=>{
    await createFullLegacyTenantSchema(database)
    await clientsFrom(pool,async clients=>{await Promise.all(clients.map(client=>client.query('SELECT 1')))})
    const before=process.env.PG_TEST_SCHEMA;await resetTestDatabase();expect(process.env.PG_TEST_SCHEMA).not.toBe(before)
    const marker=randomUUID()
    await database.query("INSERT INTO sites(site_id,name,settings,created_at,updated_at) VALUES($1,'Marker',$2,NOW(),NOW())",[marker,LEGACY_SETTINGS_JSON])
    await clientsFrom(pool,clients=>checkClients(clients,process.env.PG_TEST_SCHEMA!,marker))
  })

  it('schema缺少CREATE权限时迁移失败，全部旧表记录与字段保持不变',async()=>{
    await createFullLegacyTenantSchema(database);await preparePages();await seedUsers();owners()
    const tables=['sites','pages','inquiries','reports','jobs','knowledge_bases','knowledge_documents','analytics_events','inquiry_email_outbox','site_integrations']
    const snapshot=async()=>{const result:Record<string,unknown>={};for(const table of tables)result[table]=(await database.query(`SELECT * FROM ${table}`)).rows;return result}
    const before=await snapshot();const schema=process.env.PG_TEST_SCHEMA!
    const role=`migrator_${randomBytes(6).toString('hex')}`;const password=randomBytes(16).toString('hex')
    const admin=new pg.Pool({connectionString:getTestDatabaseUrl()})
    let limited:pg.Pool|undefined
    try{
      await admin.query(`CREATE ROLE "${role}" WITH LOGIN PASSWORD '${password}'`)
      const dbName=decodeURIComponent(new URL(getTestDatabaseUrl()).pathname.slice(1))
      if(!/^[a-zA-Z0-9_]+$/.test(dbName)||!/^[a-z][a-z0-9_]*$/.test(schema))throw new Error('数据库标识无效')
      await admin.query(`GRANT CONNECT ON DATABASE "${dbName}" TO "${role}"`)
      await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`)
      await admin.query(`REVOKE CREATE ON SCHEMA "${schema}" FROM "${role}"`)
      for(const row of (await admin.query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[schema])).rows){if(!/^[a-z][a-z0-9_]*$/.test(row.tablename))throw new Error('表名无效');await admin.query(`ALTER TABLE "${schema}"."${row.tablename}" OWNER TO "${role}"`)}
      const url=new URL(getTestDatabaseUrl());url.username=role;url.password=password
      limited=new pg.Pool({connectionString:url.href,options:`-c search_path=${schema}`})
      await expect(migrateToCollaborationModel(limited)).rejects.toThrow(/permission denied|42501|CREATE|schema|权限/i)
      expect(await legacySitesHaveTenantId(database)).toBe(true);expect(await snapshot()).toEqual(before)
    }finally{
      await limited?.end()
      await admin.query(`REASSIGN OWNED BY "${role}" TO CURRENT_USER`);await admin.query(`DROP OWNED BY "${role}"`);await admin.query(`DROP ROLE "${role}"`);await admin.end()
    }
  },120000)

  it('bootstrap-users生成凭据文件，完成迁移后能够真实登录且输出不包含密码',async()=>{
    await createFullLegacyTenantSchema(database);await preparePages()
    expect((await database.query("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='sessions'")).rowCount).toBe(0)
    const directory=path.join(packageRoot,'.intermediate',`bootstrap-${randomUUID()}`);await fs.mkdir(directory,{recursive:true})
    const credentialsPath=path.join(directory,'credentials.json')
    try{
      const result=spawnSync(process.execPath,['--import','tsx',path.join(packageRoot,'src/migration-bootstrap-users.ts')],{cwd:packageRoot,env:{...process.env,MIGRATION_BOOTSTRAP_CREDENTIALS_PATH:credentialsPath,MIGRATION_BOOTSTRAP_USERS:JSON.stringify([{account:'seanliang',name:'Sean'}])},encoding:'utf8'})
      expect(result.error).toBeUndefined();expect(result.status,`${result.stdout}\n${result.stderr}`).toBe(0)
      const credentials=JSON.parse(await fs.readFile(credentialsPath,'utf8')) as Record<string,{password:string}>
      expect(credentials.seanliang.password.length).toBeGreaterThan(16)
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(credentials.seanliang.password)
      expect((await database.query("SELECT account,name FROM users WHERE account='seanliang'")).rows).toEqual([{account:'seanliang',name:'Sean'}])
      owners();await migrateToCollaborationModel(database)
      expect((await requestJson(app,'POST','/api/auth/login',{body:{account:'seanliang',password:credentials.seanliang.password}})).status).toBe(200)
    }finally{await fs.rm(directory,{recursive:true,force:true})}
  },120000)

  it('缺少users表时迁移给出bootstrap提示并保留旧表',async()=>{
    await createFullLegacyTenantSchema(database);owners()
    await expect(migrateToCollaborationModel(database)).rejects.toThrow(/users 表|bootstrap-users/)
    expect(await legacySitesHaveTenantId(database)).toBe(true)
  })
})

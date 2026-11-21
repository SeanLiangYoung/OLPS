import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import pg from 'pg'
import { expect,it } from 'vitest'
import { verifyPassword } from './password.js'

it('账号初始化保留凭据文件、数据库密码并正确处理并发竞争',async()=>{
  const url=process.env.TEST_DATABASE_URL!
  if(!new URL(url).pathname.includes('_test_'))throw new Error('只允许专用测试数据库')
  const schema=`bootstrap_${randomUUID().replaceAll('-','')}`
  const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`)
  const database=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`})
  const root=path.resolve('../../.intermediate/cms-bootstrap-tests',schema)
  const run=(accounts:string[],credentialsPath:string):Promise<{code:number|null;error:string}>=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','src/migration-bootstrap-users.ts'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:url,PG_TEST_SCHEMA:schema,MIGRATION_BOOTSTRAP_CREDENTIALS_PATH:credentialsPath,MIGRATION_BOOTSTRAP_USERS:JSON.stringify(accounts.map(account=>({account,name:account})))}})
    let error='';child.stderr.on('data',value=>{error+=String(value)});child.stdout.resume();child.on('error',reject);child.on('close',code=>resolve({code,error}))
  })
  try{
    await fs.mkdir(root,{recursive:true})
    const blocked=path.join(root,'blocked');await fs.writeFile(blocked,'{}')
    expect((await run(['blocked-user'],path.join(blocked,'credentials.json'))).code).not.toBe(0)
    expect((await database.query('SELECT * FROM users')).rowCount).toBe(0)
    const firstFile=path.join(root,'first.json')
    expect(await run(['first-user'],firstFile)).toMatchObject({code:0})
    const credentials=await fs.readFile(firstFile,'utf8')
    const firstUser=(await database.query("SELECT * FROM users WHERE account='first-user'")).rows[0]
    expect((await run(['first-user','extra-user'],firstFile)).code).not.toBe(0)
    expect(await fs.readFile(firstFile,'utf8')).toBe(credentials)
    expect((await database.query("SELECT * FROM users WHERE account='first-user'")).rows[0]).toEqual(firstUser)
    expect((await database.query("SELECT * FROM users WHERE account='extra-user'")).rowCount).toBe(0)
    for(const accounts of [['same-user','same-user'],['different-a','different-b']]){
      const file=path.join(root,`${accounts[0]}.json`)
      const runs=await Promise.all(accounts.map(account=>run([account],file)))
      expect(runs.filter(result=>result.code===0)).toHaveLength(1)
      const saved=JSON.parse(await fs.readFile(file,'utf8')) as Record<string,{password:string}>
      expect(Object.keys(saved)).toHaveLength(1)
      expect((await database.query('SELECT * FROM users WHERE account=ANY($1)',[accounts])).rowCount).toBe(1)
      for(const [account,record] of Object.entries(saved)){
        const row=(await database.query('SELECT password_hash FROM users WHERE account=$1',[account])).rows[0]
        expect(verifyPassword(record.password,row.password_hash)).toBe(true)
      }
      expect((await fs.stat(file)).mode&0o777).toBe(0o600)
    }
  }finally{await database.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await fs.rm(root,{recursive:true,force:true})}
},120000)

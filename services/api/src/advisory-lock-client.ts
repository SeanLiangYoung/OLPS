import pg from 'pg'

export async function createAdvisoryLockClient(database:pg.Pool):Promise<pg.Client>{
  const searchPath=String((await database.query('SHOW search_path')).rows[0].search_path)
  const client=new pg.Client(database.options)
  await client.connect()
  try{
    await client.query("SELECT set_config('search_path',$1,false)",[searchPath])
    return client
  }catch(error){await client.end();throw error}
}

import type pg from 'pg'

export type CmsJobEvent = {eventId:number;jobId:string;type:string;occurredAt:string;payload:Record<string,unknown>}

export async function migrateJobEvents(client:pg.PoolClient):Promise<void>{
  await client.query('BEGIN')
  try{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('olps-job-events-schema'))")
  await client.query(`CREATE TABLE IF NOT EXISTS job_events(job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,event_id BIGINT NOT NULL,type TEXT NOT NULL,occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),payload JSONB NOT NULL,PRIMARY KEY(job_id,event_id))`)
  await client.query(`CREATE TABLE IF NOT EXISTS cms_job_requests(job_id TEXT PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,user_id TEXT NOT NULL,job_type TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,UNIQUE(user_id,job_type,idempotency_key))`)
  await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK');throw error}
}

export async function appendJobEvent(database:pg.Pool,jobId:string,type:string,payload:Record<string,unknown>):Promise<CmsJobEvent>{
  const client=await database.connect()
  try{
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`job-events:${jobId}`])
    const result=await client.query(`INSERT INTO job_events(job_id,event_id,type,payload) SELECT $1,COALESCE(MAX(event_id),0)+1,$2,$3 FROM job_events WHERE job_id=$1 RETURNING *`,[jobId,type,payload])
    await client.query('COMMIT')
    const row=result.rows[0]
    return {eventId:Number(row.event_id),jobId,type,occurredAt:new Date(row.occurred_at).toISOString(),payload:row.payload}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

export async function readJobEvents(database:pg.Pool,jobId:string,after:number):Promise<CmsJobEvent[]>{
  if(!Number.isSafeInteger(after)||after<0)throw new Error('事件序号无效')
  const result=await database.query('SELECT * FROM job_events WHERE job_id=$1 AND event_id>$2 ORDER BY event_id',[jobId,after])
  return result.rows.map(row=>({eventId:Number(row.event_id),jobId,type:row.type,occurredAt:new Date(row.occurred_at).toISOString(),payload:row.payload}))
}

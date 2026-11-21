import type pg from 'pg'

export async function createContentIndexSchema(client: pg.PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS collection_indexes(draft_id TEXT NOT NULL REFERENCES site_drafts(draft_id) ON DELETE CASCADE,collection_id TEXT NOT NULL,locale TEXT NOT NULL,slug TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','published')),revision TEXT NOT NULL,data JSONB NOT NULL,PRIMARY KEY(draft_id,collection_id,locale))`)
}

export async function indexContent(client: pg.PoolClient, draftId: string, ref: string, id: string, collectionId: string | undefined, meta: Record<string, unknown>, localized: Record<string, unknown>, revision: string): Promise<void> {
  if (ref === 'page') {
    await client.query(`INSERT INTO pages(draft_id,page_id,kind,slug,title,status,locale,seo,body,created_at,updated_at,role,revision) VALUES($1,$2,'page',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(draft_id,page_id,locale) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,status=EXCLUDED.status,seo=EXCLUDED.seo,body=EXCLUDED.body,updated_at=EXCLUDED.updated_at,role=EXCLUDED.role,revision=EXCLUDED.revision`, [draftId,id,meta.role==='not-found'?'404.html':localized.slug,localized.title,meta.status,localized.locale,localized.seo,JSON.stringify({blocks:localized.blocks}),meta.createdAt,meta.updatedAt,meta.role,revision])
    return
  }
  const table = ref === 'collection' ? 'collection_indexes' : ref === 'group' ? 'collection_groups' : 'collection_items'
  const key = ref === 'collection' ? 'collection_id' : ref === 'group' ? 'group_id' : 'item_id'
  const common = [draftId,id,localized.locale,localized.slug ?? meta.prefix,localized.title,meta.status,revision,JSON.stringify({meta,locale:localized})]
  if (ref === 'collection') {
    await client.query(`INSERT INTO ${table}(draft_id,${key},locale,slug,title,status,revision,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(draft_id,${key},locale) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,status=EXCLUDED.status,revision=EXCLUDED.revision,data=EXCLUDED.data`,common)
  } else {
    await client.query(`INSERT INTO ${table}(draft_id,${key},locale,slug,title,status,revision,data,collection_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(draft_id,${key},locale) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,status=EXCLUDED.status,revision=EXCLUDED.revision,data=EXCLUDED.data`,[...common,collectionId])
  }
}

export async function removeContentIndex(client: pg.PoolClient,draftId: string,ref: string,id: string): Promise<void> {
  const table = ref === 'page' ? 'pages' : ref === 'collection' ? 'collection_indexes' : ref === 'group' ? 'collection_groups' : 'collection_items'
  const key = ref === 'page' ? 'page_id' : ref === 'collection' ? 'collection_id' : ref === 'group' ? 'group_id' : 'item_id'
  await client.query(`DELETE FROM ${table} WHERE draft_id=$1 AND ${key}=$2`,[draftId,id])
}

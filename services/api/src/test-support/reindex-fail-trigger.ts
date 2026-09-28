import type pg from 'pg'

export const REINDEX_FAIL_SQLSTATE = 'OLPS_TEST_REINDEX_FAIL'

const triggerName = 'olps_test_pages_reindex_fail_tr'
const functionName = 'olps_test_pages_reindex_fail'

export async function installReindexFailTrigger(pool: pg.Pool, draftId: string): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger AS $$
    BEGIN
      IF NEW.draft_id = '${draftId}' THEN
        RAISE EXCEPTION '${REINDEX_FAIL_SQLSTATE}';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
  await pool.query(`
    DROP TRIGGER IF EXISTS ${triggerName} ON pages;
  `)
  await pool.query(`
    CREATE TRIGGER ${triggerName}
    BEFORE INSERT ON pages
    FOR EACH ROW EXECUTE FUNCTION ${functionName}();
  `)
}

export async function removeReindexFailTrigger(pool: pg.Pool): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON pages`)
  await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`)
}

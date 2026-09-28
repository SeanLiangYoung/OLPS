import type pg from 'pg'

export async function columnExists(
  pool: pg.Pool,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = $1
       AND column_name = $2`,
    [tableName, columnName],
  )
  return result.rowCount !== null && result.rowCount > 0
}

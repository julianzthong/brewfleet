import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { Pool, PoolClient } from 'pg'

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function withTx<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Runs each migrations/*.sql file once, in filename order, and records it.
export async function migrate() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)')
  const dir = path.join(__dirname, '..', 'migrations')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file])
    if (done.rowCount) continue
    await withTx(async (tx) => {
      await tx.query(readFileSync(path.join(dir, file), 'utf8'))
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
    })
    console.log('applied migration', file)
  }
}

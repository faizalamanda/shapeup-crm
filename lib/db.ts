import { Pool, PoolClient } from 'pg'

// Supabase Connection Pooling / Direct Connection
const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL

export const dbPool = new Pool({
  connectionString,
  max: 10, // Max concurrent connections
})

export type DBClient = PoolClient

/**
 * Execute a function within a Postgres transaction.
 * Automatically handles COMMIT on success, and ROLLBACK on error.
 */
export async function withTransaction<T>(callback: (client: DBClient) => Promise<T>): Promise<T> {
  const client = await dbPool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

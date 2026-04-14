// ============================================================
// Agora DB — Postgres clients (pooled + direct)
// ============================================================
//
// Supabase exposes two URLs:
//   - POSTGRES_URL              (pooled via Supavisor, port 6543)
//   - POSTGRES_URL_NON_POOLING  (direct, port 5432)
//
// Transactions, prepared statements, and migrations need the
// direct connection because Supavisor runs in transaction mode.
// Everything else (Functions, serverless queries) uses the pool.

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

let _pooled: ReturnType<typeof createPooled> | null = null
let _direct: ReturnType<typeof createDirect> | null = null

function resolveUrl(key: 'POSTGRES_URL' | 'POSTGRES_URL_NON_POOLING'): string {
  const url = process.env[key]
  if (!url) {
    throw new Error(
      `[@agora/db] Missing env var ${key}. ` +
        `Run \`vercel env pull\` or source .env before importing the db package.`,
    )
  }
  return url
}

function createPooled() {
  const url = resolveUrl('POSTGRES_URL')
  const sql = postgres(url, {
    // Supavisor in transaction mode disallows prepared statements.
    prepare: false,
    // Max connections per process — Supavisor handles the actual pool.
    max: 1,
    idle_timeout: 20,
  })
  return drizzle(sql, { schema })
}

function createDirect() {
  const url = resolveUrl('POSTGRES_URL_NON_POOLING')
  const sql = postgres(url, {
    // Direct connection — full Postgres features available.
    max: 1,
    idle_timeout: 20,
  })
  return { sql, db: drizzle(sql, { schema }) }
}

/** Lazy-initialized pooled client for runtime queries. */
export function getDb() {
  if (!_pooled) _pooled = createPooled()
  return _pooled
}

/**
 * Direct connection for migrations + long-running transactions.
 * Call `.sql.end()` when done with a one-shot script.
 */
export function getDirectDb() {
  if (!_direct) _direct = createDirect()
  return _direct
}

export type Database = ReturnType<typeof getDb>

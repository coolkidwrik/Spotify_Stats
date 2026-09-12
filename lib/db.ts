import 'server-only';
import postgres from 'postgres';
 
const connectionString = process.env.DATABASE_URL;
 
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Use the Supavisor SESSION-mode string: the ' +
      'pooler host on port 5432 (not 6543, and not the direct db.<ref> host).'
  );
}
 
/**
 * Next's dev server re-evaluates modules on every hot reload. Without this
 * singleton each reload creates a fresh connection pool and the old ones are
 * never closed.
 */
const globalForDb = globalThis as unknown as {
  sql?: ReturnType<typeof postgres>;
};
 
export const sql =
  globalForDb.sql ??
  postgres(connectionString, {
    /**
     * Session mode: pooler host, port 5432.
     *
     * Transaction mode (6543) left connections stuck in state=active /
     * wait_event=ClientRead — Postgres had finished executing and waited for
     * the driver to read the result, draining the pool after a few renders.
     * Postgres's own statement_timeout can't help there, since execution had
     * already completed.
     *
     * The direct host (db.<ref>.supabase.co) avoids that but is IPv6-only, so
     * on IPv4 networks every query silently failed to connect and each section
     * fell back to its empty state.
     *
     * Session mode gives a dedicated connection per client for the life of the
     * session: pooled, IPv4-reachable, no mid-session handoff.
     */
    prepare: true, // supported in session mode; not in transaction mode
 
    // Each serverless instance holds its own connections until idle_timeout.
    // If Vercel reports connection-limit errors, LOWER this rather than
    // raising it.
    max: 5,
 
    idle_timeout: 20,
    connect_timeout: 10,
 
    // Server-side only. postgres.js has no client-side query abort — its
    // `timeout` option is deprecated and merely aliases idle_timeout, so
    // don't reach for it expecting one. Session mode, not a timeout, is what
    // protects against the ClientRead stall described above.
    connection: { statement_timeout: 10_000 },
 
    onnotice: () => {},
  });
 
if (process.env.NODE_ENV !== 'production') globalForDb.sql = sql;
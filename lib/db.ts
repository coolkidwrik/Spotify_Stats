import 'server-only';
import postgres from 'postgres';
 
const connectionString = process.env.DATABASE_URL;
 
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Use the Supavisor transaction-pooler string ' +
      '(port 6543) from the Supabase dashboard, not the direct connection.'
  );
}
 
export const sql = postgres(connectionString, {
  // Required. Supavisor transaction mode shares one backend connection across
  // many clients, so a prepared statement created on one query may not exist
  // when the next runs. Leaving this true produces intermittent
  // "prepared statement does not exist" errors that only appear under load.
  prepare: false,
 
  // One connection per serverless instance. Vercel spins up many instances;
  // the pooler is what does the actual pooling, not this client.
  max: 1,
 
  idle_timeout: 20,
  connect_timeout: 10,
});
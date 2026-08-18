// Called by the scheduler every 30 minutes. Every failure path returns a
// non-2xx so `curl --fail` (or cron-job.org's own failure detection) catches
// it. Nothing here fails quietly.
 
import { spotifyJson, SpotifyAuthError } from '@/lib/spotify/client';
import { sql } from '@/lib/db';
import {
  getCursor,
  setCursor,
  insertPlays,
  type RecentlyPlayedItem,
} from '@/lib/plays/ingest';
 
export const dynamic = 'force-dynamic';
 
/** Refresh tokens expire 6 months after authorization. Warn 15 days early. */
const TOKEN_LIFETIME_DAYS = 180;
const TOKEN_WARN_AT_DAYS = 165;
 
function tokenAgeDays(): number | null {
  const issued = process.env.SPOTIFY_TOKEN_ISSUED; // e.g. "2026-08-10"
  if (!issued) return null;
  const ms = Date.now() - new Date(issued).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000);
}
 
async function recordRun(
  status: 'ok' | 'error',
  inserted: number,
  windowSize: number,
  error: string | null
) {
  await sql`
    insert into ingest_runs (ran_at, status, inserted, window_size, error)
    values (now(), ${status}, ${inserted}, ${windowSize}, ${error})
  `;
}
 
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    // Not a no-op: a 401 means the secret drifted between Vercel and the
    // scheduler, and nothing is being collected.
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
 
  const age = tokenAgeDays();
 
  try {
    const cursor = await getCursor();
 
    const qs = new URLSearchParams({ limit: '50' });
    if (cursor) qs.set('after', String(cursor));
 
    const data = await spotifyJson<{ items: RecentlyPlayedItem[] }>(
      `/me/player/recently-played?${qs}`
    );
 
    // spotifyJson returns null on any non-OK response. That is not the same as
    // "no new plays", so don't let it look like success.
    if (data === null) {
      await recordRun('error', 0, 0, 'spotify returned no data');
      return Response.json(
        { ok: false, error: 'spotify_unavailable' },
        { status: 502 }
      );
    }
 
    const items = data.items ?? [];
    const inserted = await insertPlays(items);
 
    if (items.length) {
      const newest = Math.max(...items.map((i) => Date.parse(i.played_at)));
      await setCursor(newest);
    }
 
    await recordRun('ok', inserted, items.length, null);
 
    return Response.json({
      ok: true,
      inserted,
      // 50 means the window was saturated and plays were probably lost.
      windowSize: items.length,
      tokenExpiresInDays: age === null ? null : TOKEN_LIFETIME_DAYS - age,
      tokenWarning: age !== null && age >= TOKEN_WARN_AT_DAYS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
 
    // Auth failure is terminal until you re-authorize; retrying won't help.
    const status = err instanceof SpotifyAuthError ? 503 : 500;
 
    try {
      await recordRun('error', 0, 0, message.slice(0, 500));
    } catch {
      // Database unreachable too. The non-2xx below is the only signal left —
      // which is exactly why the alarm can't live solely in the database.
    }
 
    console.error('[ingest]', message);
    return Response.json({ ok: false, error: message }, { status });
  }
}
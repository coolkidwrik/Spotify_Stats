// Called by the scheduler every 30 minutes. Every failure path returns a
// non-2xx so cron-job.org's failure detection catches it. Nothing fails
// quietly.
 
import { spotifyJson, SpotifyAuthError } from '@/lib/spotify/client';
import { sql } from '@/lib/db';
import {
  getCursor,
  setCursor,
  insertPlays,
  samplePlayerState,
  type RecentlyPlayedItem,
} from '@/lib/plays/ingest';
import { resolvePendingContexts } from '@/lib/spotify/contexts';
import { runEnrichment, queueNewTracks } from '@/lib/enrich/resolver';
import { waitUntil } from '@vercel/functions';

export const dynamic = 'force-dynamic';

/**
 * The response returns in a couple of seconds, but enrichment continues in the
 * background via waitUntil — this is the ceiling for that background work.
 */
export const maxDuration = 120;

/** Refresh tokens expire 6 months after authorization. Warn 15 days early. */
const TOKEN_LIFETIME_DAYS = 180;
const TOKEN_WARN_AT_DAYS = 165;

/** How many unresolved playlist/album names to look up per run. */
const CONTEXTS_PER_RUN = 10;

function tokenAgeDays(): number | null {
  const issued = process.env.SPOTIFY_TOKEN_ISSUED; // e.g. "2026-08-17"
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

    // Both calls in parallel. The player sample is best-effort and swallows
    // its own errors, so it can never fail the ingest.
    const [data, sampled] = await Promise.all([
      spotifyJson<{ items: RecentlyPlayedItem[] }>(
        `/me/player/recently-played?${qs}`
      ),
      samplePlayerState(),
    ]);

    // spotifyJson returns null on any non-OK response — not the same as
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

    // After the cursor is advanced and the run is recorded, so a slow or
    // failing resolver can never cost us plays. It catches internally and
    // returns 0 rather than throwing.
    const contextsResolved = await resolvePendingContexts(CONTEXTS_PER_RUN);

    // Enrichment runs in the BACKGROUND, not before the response.
    //
    // cron-job.org caps a request at 30 seconds, and the enrichment budget
    // alone is 45 — MusicBrainz allows one request per second, so a batch is
    // inherently slow. Awaiting it here would make every run report as failed
    // (and email about it) despite the ingest having succeeded.
    //
    // waitUntil keeps the serverless function alive until the promise settles,
    // bounded by maxDuration above, while the response goes out immediately.
    // Everything that matters has already committed by this point: the plays
    // are written, the cursor is advanced, the run is recorded.
    //
    // The trade: enrichment counts are no longer in the response. Check
    // progress with a query against track_enrichment, or the Vercel logs.
    waitUntil(
      (async () => {
        try {
          await queueNewTracks();
          const result = await runEnrichment();
          console.log('[enrich]', JSON.stringify(result));
        } catch (err) {
          console.warn('[enrich] background pass failed:', err);
        }
      })()
    );

    return Response.json({
      ok: true,
      inserted,
      // 50 means the window saturated and plays were probably lost.
      windowSize: items.length,
      playerSampled: sampled,
      contextsResolved,
      enrichmentQueued: true,
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
      // which is why an absent error row in ingest_runs is itself diagnostic.
    }

    console.error('[ingest]', message);
    return Response.json({ ok: false, error: message }, { status });
  }
}
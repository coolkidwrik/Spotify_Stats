// Walks the enrichment queue: Spotify ISRC -> Last.fm tags -> MusicBrainz
// language. Called from the ingest cron run.
//
// Budgeted on purpose. MusicBrainz allows 1 request/second, so a batch of 20
// tracks can spend ~20 seconds in that client alone. The whole resolver is
// capped by BUDGET_MS and returns partial progress rather than running long —
// the queue is drained over many runs, and there is no deadline.
//
// Never throws. Ingestion must not depend on enrichment.

import 'server-only';
import { sql } from '@/lib/db';
import { getTrackTags, getArtistTags, lastfmConfigured } from './lastfm';
import { lookupByIsrc } from './musicbrainz';
import { languageFromTags, languageFromScript } from './language';

const TRACKS_PER_RUN = 20;
// Higher than tracks: no MusicBrainz call in this loop, so each artist is
// one fast Last.fm request rather than a rate-limited pair.
const ARTISTS_PER_RUN = 25;
const MAX_ATTEMPTS = 3;
/**
 * Wall-clock ceiling for one pass. This runs in the background via waitUntil,
 * so it does not delay the cron response — but it still counts against the
 * route's maxDuration, so it must leave headroom under that.
 */
const BUDGET_MS = 90_000;
/**
 * Slice reserved for the artist loop, which runs FIRST.
 *
 * The first production pass resolved 14 tracks and 0 artists. Both loops
 * shared one deadline, the track loop ran first, and its per-track MusicBrainz
 * call (1.1s of mandated throttle plus the request) consumed all 90 seconds —
 * so the artist loop never executed at all.
 *
 * Artists are both cheaper (one Last.fm call each, no rate-limited lookup) and
 * more valuable (artist tags have far better coverage than track tags), and
 * there are fewer of them. They get a guaranteed slice at the front.
 */
const ARTIST_BUDGET_MS = 30_000;

const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

export interface EnrichResult {
  tracksResolved: number;
  artistsResolved: number;
  tagsWritten: number;
  languagesFound: number;
}

const EMPTY: EnrichResult = {
  tracksResolved: 0,
  artistsResolved: 0,
  tagsWritten: 0,
  languagesFound: 0,
};

// ---------------------------------------------------------------------------
// Spotify (ISRC only)
// ---------------------------------------------------------------------------

/**
 * Own token refresh rather than spotifyFetch: that helper sleeps and retries
 * on 429, which would blow the budget. Here a rate limit is simply a miss and
 * the track stays pending.
 */
async function spotifyToken(): Promise<string | null> {
  try {
    const res = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: process.env.SPOTIFY_REFRESH_TOKEN ?? '',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()).access_token ?? null;
  } catch {
    return null;
  }
}

async function fetchIsrc(
  trackId: string,
  token: string
): Promise<string | null> {
  try {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { external_ids?: { isrc?: string } };
    return data.external_ids?.isrc ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function writeTrackTags(
  trackId: string,
  tags: { tag: string; weight: number }[]
): Promise<number> {
  if (!tags.length) return 0;
  const rows = tags.map((t) => ({
    track_id: trackId,
    tag: t.tag,
    weight: Math.min(t.weight, 32_767),
  }));
  await sql`
    insert into track_tags ${sql(rows, 'track_id', 'tag', 'weight')}
    on conflict (track_id, tag) do update set weight = excluded.weight
  `;
  return rows.length;
}

async function writeArtistTags(
  artistId: string,
  tags: { tag: string; weight: number }[]
): Promise<number> {
  if (!tags.length) return 0;
  const rows = tags.map((t) => ({
    artist_id: artistId,
    tag: t.tag,
    weight: Math.min(t.weight, 32_767),
  }));
  await sql`
    insert into artist_tags ${sql(rows, 'artist_id', 'tag', 'weight')}
    on conflict (artist_id, tag) do update set weight = excluded.weight
  `;
  return rows.length;
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

interface PendingTrack {
  track_id: string;
  track_name: string;
  artist_name: string | null;
  isrc: string | null;
  attempts: number;
}

async function resolveTracks(
  deadline: number,
  out: EnrichResult
): Promise<void> {
  const pending = await sql<PendingTrack[]>`
    select
      te.track_id,
      t.track_name,
      (select ar.artist_name
         from track_artists ta
         join artists ar on ar.artist_id = ta.artist_id
        where ta.track_id = te.track_id
        order by ta.position
        limit 1) as artist_name,
      te.isrc,
      te.attempts
    from track_enrichment te
    join tracks t on t.track_id = te.track_id
    where te.resolved_at is null
      and te.attempts < ${MAX_ATTEMPTS}
    order by te.attempts, te.track_id
    limit ${TRACKS_PER_RUN}
  `;

  if (!pending?.length) return;

  const token = await spotifyToken();

  for (const row of pending) {
    if (Date.now() > deadline) break;

    let isrc = row.isrc;
    let mbid: string | null = null;
    let language: string | null = null;
    let languageSource: string | null = null;
    let tagCount = 0;

    try {
      // 1. Tags. The primary payload — do this before the slow MusicBrainz
      //    call, so a budget overrun still leaves us with the useful part.
      if (lastfmConfigured() && row.artist_name) {
        const tags = await getTrackTags(row.artist_name, row.track_name);
        if (tags?.length) {
          tagCount = await writeTrackTags(row.track_id, tags);
          out.tagsWritten += tagCount;

          // 2. Language from a tag, before falling back to MusicBrainz.
          const fromTag = languageFromTags(tags.map((t) => t.tag));
          if (fromTag) {
            language = fromTag;
            languageSource = 'tag';
          }
        }
      }

      // 3. Script of the title. Moved AHEAD of MusicBrainz: it costs
      //    microseconds, and for a Hangul or Kana title it is about as
      //    reliable as MusicBrainz's work language — which is often absent
      //    for exactly those tracks anyway. It returns null for every
      //    Latin-script title, which is precisely where MusicBrainz is worth
      //    a second of budget.
      if (!language) {
        const fromScript = languageFromScript(row.track_name);
        if (fromScript) {
          language = fromScript;
          languageSource = 'script';
        }
      }

      // 4. ISRC, if not already stored. The join key into MusicBrainz.
      if (!isrc && token) {
        isrc = await fetchIsrc(row.track_id, token);
      }

      // 5. MusicBrainz. Authoritative, but 1 req/sec — the budget bottleneck,
      //    so it only runs when neither a tag nor the script answered.
      if (isrc && !language) {
        const rec = await lookupByIsrc(isrc);
        if (rec) {
          mbid = rec.mbid;
          if (rec.language) {
            language = rec.language;
            languageSource = 'musicbrainz';
          }
        }
      }

      if (language) out.languagesFound++;

      // Anything found at all counts as resolved; nothing found but no error
      // is 'partial' and will not be retried past MAX_ATTEMPTS.
      const status = tagCount || language || isrc ? 'ok' : 'partial';

      await sql`
        update track_enrichment set
          isrc            = coalesce(${isrc}, isrc),
          mbid            = coalesce(${mbid}, mbid),
          language        = coalesce(${language}, language),
          language_source = coalesce(${languageSource}, language_source),
          status          = ${status},
          attempts        = attempts + 1,
          resolved_at     = now(),
          last_error      = null
        where track_id = ${row.track_id}
      `;

      out.tracksResolved++;
    } catch (err) {
      // Increment attempts but leave resolved_at NULL, so it retries — up to
      // MAX_ATTEMPTS, after which the partial index stops selecting it.
      const message = err instanceof Error ? err.message : String(err);
      await sql`
        update track_enrichment
           set attempts = attempts + 1, last_error = ${message.slice(0, 300)}
         where track_id = ${row.track_id}
      `.catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

async function resolveArtists(
  deadline: number,
  out: EnrichResult
): Promise<void> {
  const pending = await sql<
    { artist_id: string; artist_name: string; attempts: number }[]
  >`
    select artist_id, artist_name, attempts
    from artists
    where resolved_at is null
      and attempts < ${MAX_ATTEMPTS}
      and artist_name <> '(unresolved)'
    order by attempts, artist_id
    limit ${ARTISTS_PER_RUN}
  `;

  if (!pending?.length) return;

  for (const row of pending) {
    if (Date.now() > deadline) break;

    try {
      let wrote = 0;

      // Artist tags only. Their coverage is much better than track-level tags
      // — obscure tracks go untagged, their artists usually don't — so these
      // carry most of the signal for a similarity score.
      //
      // No MusicBrainz call here on purpose: artist country is redundant with
      // tags for scoring, and the search runs at 1 req/sec, which would halve
      // artist throughput for a field nothing uses. Last.fm runs ~5x faster.
      if (lastfmConfigured()) {
        const tags = await getArtistTags(row.artist_name);
        if (tags?.length) {
          wrote = await writeArtistTags(row.artist_id, tags);
          out.tagsWritten += wrote;
        }
      }

      await sql`
        update artists set
          status      = ${wrote ? 'ok' : 'partial'},
          attempts    = attempts + 1,
          resolved_at = now()
        where artist_id = ${row.artist_id}
      `;

      out.artistsResolved++;
    } catch {
      await sql`
        update artists set attempts = attempts + 1
         where artist_id = ${row.artist_id}
      `.catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * One enrichment pass. Call after the ingest has committed, so a slow or
 * failing resolver can never cost plays.
 */
export async function runEnrichment(): Promise<EnrichResult> {
  const out: EnrichResult = { ...EMPTY };
  const hardDeadline = Date.now() + BUDGET_MS;

  try {
    // Artists first, on their own slice, so the track loop can never starve
    // them again. Once the artist queue drains this costs nothing: the select
    // returns no rows, the function returns immediately, and tracks inherit
    // the full budget.
    await resolveArtists(Date.now() + ARTIST_BUDGET_MS, out);
    await resolveTracks(hardDeadline, out);
  } catch (err) {
    console.warn('[enrich] pass failed:', err);
  }

  return out;
}

/** New tracks need a queue row; called from the ingest. */
export async function queueNewTracks(): Promise<void> {
  await sql`
    insert into track_enrichment (track_id)
    select track_id from tracks
    on conflict (track_id) do nothing
  `;
}
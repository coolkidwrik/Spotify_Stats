import 'server-only';
import { sql } from '@/lib/db';

/**
 * played_at is stored in UTC. Midnight in Vancouver is 07:00 or 08:00 UTC
 * depending on DST, so every period boundary is computed in the display zone
 * and converted BACK to timestamptz.
 *
 * The direction matters. Writing
 *
 *   where played_at at time zone TZ >= date_trunc('day', ...)
 *
 * puts a function on the indexed column, making plays_played_at_idx unusable.
 * Writing
 *
 *   where played_at >= (date_trunc('day', now() at time zone TZ) at time zone TZ)
 *
 * compares the raw column against a constant, so the index applies.
 */
const TZ = process.env.STATS_TIMEZONE ?? 'America/Vancouver';

// ---------------------------------------------------------------------------
// Listening clock
// ---------------------------------------------------------------------------

export interface ClockHour {
  hour: number;
  plays: number;
}

/**
 * Plays by hour of day. Always 24 rows, zero-filled.
 *
 * Aggregate first, then join the 24 generated hours against the result.
 * Putting extract(hour from ...) in the join condition instead scans the table
 * once per hour. Reads plays alone — no joins needed.
 */
export async function getListeningClock(days = 30): Promise<ClockHour[]> {
  try {
    const rows = await sql<ClockHour[]>`
      with counted as (
        select
          extract(hour from played_at at time zone ${TZ})::int as hour,
          count(*)::int as plays
        from plays
        where played_at >= now() - (${days} * interval '1 day')
        group by 1
      ),
      hours as (select generate_series(0, 23) as hour)
      select h.hour::int as hour, coalesce(c.plays, 0)::int as plays
      from hours h
      left join counted c on c.hour = h.hour
      order by h.hour
    `;
    return rows ?? [];
  } catch (err) {
    console.error('[plays] listening clock failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Where listening comes from
// ---------------------------------------------------------------------------

export interface ContextBreakdown {
  contextType: string;
  plays: number;
  share: number;
}

export interface TopContext {
  contextUri: string;
  contextType: string;
  plays: number;
  tracks: number;
  /** From the contexts table; null until the cron resolver has reached it. */
  name: string | null;
  image: string | null;
}

/** Playlist vs album vs artist page vs direct (context is null from search). */
export async function getContextBreakdown(
  days = 30
): Promise<ContextBreakdown[]> {
  try {
    const rows = await sql<{ context_type: string | null; plays: number }[]>`
      select
        coalesce(c.context_type, 'direct') as context_type,
        count(*)::int as plays
      from plays p
      left join contexts c on c.context_uri = p.context_uri
      where p.played_at >= now() - (${days} * interval '1 day')
      group by 1
      order by count(*) desc
    `;

    if (!rows?.length) return [];

    const total = rows.reduce((sum, r) => sum + r.plays, 0) || 1;
    return rows.map((r) => ({
      contextType: r.context_type ?? 'direct',
      plays: r.plays,
      share: r.plays / total,
    }));
  } catch (err) {
    console.error('[plays] context breakdown failed:', err);
    return [];
  }
}

/**
 * The specific playlists and albums driving the most listening.
 *
 * Names come from the contexts table rather than a per-request Spotify
 * lookup, so this is a plain join. The cron resolver fills them in; a NULL
 * name renders a generic label.
 */
export async function getTopContexts(
  days = 30,
  limit = 8
): Promise<TopContext[]> {
  try {
    const rows = await sql<
      {
        context_uri: string;
        context_type: string;
        plays: number;
        tracks: number;
        name: string | null;
        image_url: string | null;
      }[]
    >`
      select
        c.context_uri,
        c.context_type,
        count(*)::int as plays,
        count(distinct p.track_id)::int as tracks,
        c.name,
        c.image_url
      from plays p
      join contexts c on c.context_uri = p.context_uri
      where p.played_at >= now() - (${days} * interval '1 day')
      group by c.context_uri, c.context_type, c.name, c.image_url
      order by count(*) desc
      limit ${limit}
    `;

    if (!rows?.length) return [];

    return rows.map((r) => ({
      contextUri: r.context_uri,
      contextType: r.context_type,
      plays: r.plays,
      tracks: r.tracks,
      name: r.name,
      image: r.image_url,
    }));
  } catch (err) {
    console.error('[plays] top contexts failed:', err);
    return [];
  }
}

/** Contexts that still need a Spotify lookup, for the cron resolver. */
export async function getUnresolvedContexts(limit = 10): Promise<string[]> {
  const rows = await sql<{ context_uri: string }[]>`
    select context_uri from contexts
    where resolved_at is null
    order by context_uri
    limit ${limit}
  `;
  return (rows ?? []).map((r) => r.context_uri);
}

/** A successful lookup: record the name and close the row. */
export async function saveContextInfo(
  uri: string,
  name: string | null,
  imageUrl: string | null
): Promise<void> {
  await sql`
    update contexts
       set name = ${name}, image_url = ${imageUrl}, resolved_at = now()
     where context_uri = ${uri}
  `;
}

/**
 * Close a context that will never resolve — a 404, or a context type with no
 * endpoint to fetch.
 *
 * Kept separate from saveContextInfo on purpose. The first version of the
 * resolver closed the row on ANY failed lookup, which could not tell "deleted"
 * from "not authorized" — so one missing OAuth scope permanently wrote off
 * every private playlist. Transient failures (401/403/429/5xx) must leave
 * resolved_at NULL so the next run retries them.
 */
export async function markContextGone(uri: string): Promise<void> {
  await sql`
    update contexts
       set resolved_at = now()
     where context_uri = ${uri}
  `;
}

// ---------------------------------------------------------------------------
// Period comparisons
// ---------------------------------------------------------------------------

export interface PeriodTotals {
  plays: number;
  tracks: number;
  artists: number;
  ms: number;
}

export interface PeriodComparison {
  current: PeriodTotals;
  previous: PeriodTotals;
}

export const emptyTotals: PeriodTotals = {
  plays: 0,
  tracks: 0,
  artists: 0,
  ms: 0,
};

export const emptyComparison: PeriodComparison = {
  current: emptyTotals,
  previous: emptyTotals,
};

type TotalsRow = {
  plays: string;
  tracks: string;
  artists: string;
  ms: string;
};

function toTotals(rows: TotalsRow[] | undefined): PeriodTotals {
  const r = rows?.[0];
  return {
    plays: Number(r?.plays ?? 0),
    tracks: Number(r?.tracks ?? 0),
    artists: Number(r?.artists ?? 0),
    ms: Number(r?.ms ?? 0),
  };
}

/**
 * Today vs yesterday, over the SAME ELAPSED TIME.
 *
 * At 9am today has two hours of data and yesterday has twenty-four, so an
 * unclipped comparison reports ~90% down every morning. The previous window is
 * cut at the same wall-clock point the current one has reached.
 *
 * ms sums each track's FULL duration — the API exposes no ms_played — so
 * anything heard for 30+ seconds counts as complete. It is an upper bound.
 *
 * "artists" counts distinct PRIMARY artists (track_artists.position = 0),
 * matching what the old artist_id column meant.
 */
export async function getDailyComparison(): Promise<PeriodComparison> {
  try {
    const [current, previous] = await Promise.all([
      sql<TotalsRow[]>`
        select
          count(*) as plays,
          count(distinct p.track_id) as tracks,
          count(distinct ta.artist_id) as artists,
          coalesce(sum(t.duration_ms), 0) as ms
        from plays p
        join tracks t on t.track_id = p.track_id
        left join track_artists ta
          on ta.track_id = p.track_id and ta.position = 0
        where p.played_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})
      `,
      sql<TotalsRow[]>`
        select
          count(*) as plays,
          count(distinct p.track_id) as tracks,
          count(distinct ta.artist_id) as artists,
          coalesce(sum(t.duration_ms), 0) as ms
        from plays p
        join tracks t on t.track_id = p.track_id
        left join track_artists ta
          on ta.track_id = p.track_id and ta.position = 0
        where p.played_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})
                             - interval '1 day'
          and p.played_at <  (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})
                             - interval '1 day'
                             + ((now() at time zone ${TZ})
                                - date_trunc('day', now() at time zone ${TZ}))
      `,
    ]);

    return { current: toTotals(current), previous: toTotals(previous) };
  } catch (err) {
    console.error('[plays] daily comparison failed:', err);
    return emptyComparison;
  }
}

/**
 * This week vs last week, clipped the same way.
 *
 * date_trunc('week', ...) starts on Monday, so early in the week this compares
 * a few hours against the same few hours last Monday.
 *
 * The 'week' literal stays inline rather than parameterized: passing the unit
 * into date_trunc as a bind parameter forces Postgres to infer its type.
 */
export async function getWeeklyComparison(): Promise<PeriodComparison> {
  try {
    const [current, previous] = await Promise.all([
      sql<TotalsRow[]>`
        select
          count(*) as plays,
          count(distinct p.track_id) as tracks,
          count(distinct ta.artist_id) as artists,
          coalesce(sum(t.duration_ms), 0) as ms
        from plays p
        join tracks t on t.track_id = p.track_id
        left join track_artists ta
          on ta.track_id = p.track_id and ta.position = 0
        where p.played_at >= (date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})
      `,
      sql<TotalsRow[]>`
        select
          count(*) as plays,
          count(distinct p.track_id) as tracks,
          count(distinct ta.artist_id) as artists,
          coalesce(sum(t.duration_ms), 0) as ms
        from plays p
        join tracks t on t.track_id = p.track_id
        left join track_artists ta
          on ta.track_id = p.track_id and ta.position = 0
        where p.played_at >= (date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})
                             - interval '1 week'
          and p.played_at <  (date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})
                             - interval '1 week'
                             + ((now() at time zone ${TZ})
                                - date_trunc('week', now() at time zone ${TZ}))
      `,
    ]);

    return { current: toTotals(current), previous: toTotals(previous) };
  } catch (err) {
    console.error('[plays] weekly comparison failed:', err);
    return emptyComparison;
  }
}

// ---------------------------------------------------------------------------
// Period highlights
// ---------------------------------------------------------------------------

export interface Highlight {
  id: string;
  name: string;
  detail: string | null;
  art: string | null;
  plays: number;
}

export interface PeriodHighlights {
  topTrack: Highlight | null;
  topArtist: Highlight | null;
}

export const emptyHighlights: PeriodHighlights = {
  topTrack: null,
  topArtist: null,
};

type TrackRow = {
  id: string;
  name: string;
  detail: string | null;
  art: string | null;
  plays: number;
};

type ArtistRow = {
  id: string;
  name: string;
  art: string | null;
  plays: number;
};

function toHighlights(
  trackRows: TrackRow[] | undefined,
  artistRows: ArtistRow[] | undefined
): PeriodHighlights {
  const t = trackRows?.[0];
  const a = artistRows?.[0];
  return {
    topTrack: t
      ? { id: t.id, name: t.name, detail: t.detail, art: t.art, plays: t.plays }
      : null,
    topArtist: a
      ? { id: a.id, name: a.name, detail: null, art: a.art, plays: a.plays }
      : null,
  };
}

/**
 * Most-played track and artist today.
 *
 * The artist query joins artists directly, so the name is that artist's own
 * name rather than the full credit string of whichever track played last —
 * the bug the denormalized schema produced.
 *
 * Artist art is borrowed from an album cover: there is no artist image in this
 * schema, and fetching one would mean a Spotify lookup per artist.
 */
export async function getTodayHighlights(): Promise<PeriodHighlights> {
  try {
    const [trackRows, artistRows] = await Promise.all([
      sql<TrackRow[]>`
        select
          t.track_id as id,
          t.track_name as name,
          (select string_agg(ar.artist_name, ', ' order by ta2.position)
             from track_artists ta2
             join artists ar on ar.artist_id = ta2.artist_id
            where ta2.track_id = t.track_id) as detail,
          al.album_art as art,
          count(*)::int as plays
        from plays p
        join tracks t on t.track_id = p.track_id
        left join albums al on al.album_id = t.album_id
        where p.played_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})
        group by t.track_id, t.track_name, al.album_art
        -- Tiebreak on earliest play so the winner is stable between renders.
        order by count(*) desc, min(p.played_at)
        limit 1
      `,
      sql<ArtistRow[]>`
        select
          ar.artist_id as id,
          ar.artist_name as name,
          (array_agg(al.album_art order by p.played_at desc)
            filter (where al.album_art is not null))[1] as art,
          count(*)::int as plays
        from plays p
        join tracks t on t.track_id = p.track_id
        join track_artists ta
          on ta.track_id = p.track_id and ta.position = 0
        join artists ar on ar.artist_id = ta.artist_id
        left join albums al on al.album_id = t.album_id
        where p.played_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})
        group by ar.artist_id, ar.artist_name
        order by count(*) desc, min(p.played_at)
        limit 1
      `,
    ]);

    return toHighlights(trackRows, artistRows);
  } catch (err) {
    console.error('[plays] today highlights failed:', err);
    return emptyHighlights;
  }
}

/** Most-played track and artist this week. Same shape, week boundary. */
export async function getWeekHighlights(): Promise<PeriodHighlights> {
  try {
    const [trackRows, artistRows] = await Promise.all([
      sql<TrackRow[]>`
        select
          t.track_id as id,
          t.track_name as name,
          (select string_agg(ar.artist_name, ', ' order by ta2.position)
             from track_artists ta2
             join artists ar on ar.artist_id = ta2.artist_id
            where ta2.track_id = t.track_id) as detail,
          al.album_art as art,
          count(*)::int as plays
        from plays p
        join tracks t on t.track_id = p.track_id
        left join albums al on al.album_id = t.album_id
        where p.played_at >= (date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})
        group by t.track_id, t.track_name, al.album_art
        order by count(*) desc, min(p.played_at)
        limit 1
      `,
      sql<ArtistRow[]>`
        select
          ar.artist_id as id,
          ar.artist_name as name,
          (array_agg(al.album_art order by p.played_at desc)
            filter (where al.album_art is not null))[1] as art,
          count(*)::int as plays
        from plays p
        join tracks t on t.track_id = p.track_id
        join track_artists ta
          on ta.track_id = p.track_id and ta.position = 0
        join artists ar on ar.artist_id = ta.artist_id
        left join albums al on al.album_id = t.album_id
        where p.played_at >= (date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})
        group by ar.artist_id, ar.artist_name
        order by count(*) desc, min(p.played_at)
        limit 1
      `,
    ]);

    return toHighlights(trackRows, artistRows);
  } catch (err) {
    console.error('[plays] week highlights failed:', err);
    return emptyHighlights;
  }
}

// ---------------------------------------------------------------------------
// Collection metadata
// ---------------------------------------------------------------------------

export interface CollectionInfo {
  since: Date | null;
  totalPlays: number;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
}

export const emptyCollectionInfo: CollectionInfo = {
  since: null,
  totalPlays: 0,
  lastRunAt: null,
  lastRunStatus: null,
};

export async function getCollectionInfo(): Promise<CollectionInfo> {
  try {
    const [meta, runs] = await Promise.all([
      sql<{ since: Date | null; total: string }[]>`
        select min(played_at) as since, count(*) as total from plays
      `,
      sql<{ ran_at: Date; status: string }[]>`
        select ran_at, status from ingest_runs order by ran_at desc limit 1
      `,
    ]);

    return {
      since: meta?.[0]?.since ?? null,
      totalPlays: Number(meta?.[0]?.total ?? 0),
      lastRunAt: runs?.[0]?.ran_at ?? null,
      lastRunStatus: runs?.[0]?.status ?? null,
    };
  } catch (err) {
    console.error('[plays] collection info failed:', err);
    return emptyCollectionInfo;
  }
}
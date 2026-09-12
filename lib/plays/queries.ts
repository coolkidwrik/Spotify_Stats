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
 * puts a function on the indexed column, making plays_played_at_idx unusable
 * and forcing a sequential scan with a per-row conversion. Writing
 *
 *   where played_at >= (date_trunc('day', now() at time zone TZ) at time zone TZ)
 *
 * compares the raw column against a constant, so the index applies.
 *
 * The zone is handled per query rather than via a connection-level TimeZone
 * setting, so these queries mean the same thing regardless of how the client
 * is configured.
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
 * Aggregate first, then join the 24 generated hours against the result. Putting
 * extract(hour from ...) in the join condition instead scans the table once per
 * hour. The conversion here is in the SELECT, not the WHERE, so the range
 * filter still uses the index.
 */
export async function getListeningClock(days = 30): Promise<ClockHour[]> {
  return sql<ClockHour[]>`
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
  sampleTrack: string;
}
 
/** Playlist vs album vs artist page vs direct (context is null from search). */
export async function getContextBreakdown(
  days = 30
): Promise<ContextBreakdown[]> {
  const rows = await sql<{ context_type: string | null; plays: number }[]>`
    select
      coalesce(context_type, 'direct') as context_type,
      count(*)::int as plays
    from plays
    where played_at >= now() - (${days} * interval '1 day')
    group by 1
    order by count(*) desc
  `;
 
  const total = rows.reduce((sum, r) => sum + r.plays, 0) || 1;
  return rows.map((r) => ({
    contextType: r.context_type ?? 'direct',
    plays: r.plays,
    share: r.plays / total,
  }));
}
 
/**
 * The specific playlists/albums driving the most listening.
 * Names are resolved separately by lib/spotify/contexts.
 */
export async function getTopContexts(
  days = 30,
  limit = 8
): Promise<TopContext[]> {
  const rows = await sql<
    {
      context_uri: string;
      context_type: string;
      plays: number;
      sample_track: string;
    }[]
  >`
    select
      context_uri,
      context_type,
      count(*)::int as plays,
      (array_agg(track_name order by played_at desc))[1] as sample_track
    from plays
    where played_at >= now() - (${days} * interval '1 day')
      and context_uri is not null
    group by context_uri, context_type
    order by count(*) desc
    limit ${limit}
  `;
 
  return rows.map((r) => ({
    contextUri: r.context_uri,
    contextType: r.context_type,
    plays: r.plays,
    sampleTrack: r.sample_track,
  }));
}
 
// ---------------------------------------------------------------------------
// Period comparisons
//
// Two plain single-statement queries rather than one CTE + union all. The
// combined form is what first surfaced the ClientRead stalls; these are simpler
// to reason about and plan.
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
 
function toTotals(rows: TotalsRow[]): PeriodTotals {
  const r = rows[0];
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
 * A naive comparison is useless: at 9am today has two hours of data and
 * yesterday has twenty-four, so today always reads ~90% down. The previous
 * window is clipped at the same wall-clock point the current one has reached.
 *
 * ms sums each track's full duration — the API exposes no ms_played — so
 * anything heard for 30+ seconds counts as complete. It is an upper bound.
 */
export async function getDailyComparison(): Promise<PeriodComparison> {
  const [current, previous] = await Promise.all([
    sql<TotalsRow[]>`
      select
        count(*) as plays,
        count(distinct track_id) as tracks,
        count(distinct artist_id) as artists,
        coalesce(sum(duration_ms), 0) as ms
      from plays
      where played_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})
    `,
    sql<TotalsRow[]>`
      select
        count(*) as plays,
        count(distinct track_id) as tracks,
        count(distinct artist_id) as artists,
        coalesce(sum(duration_ms), 0) as ms
      from plays
      where played_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})
                         - interval '1 day'
        and played_at <  (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})
                         - interval '1 day'
                         + ((now() at time zone ${TZ})
                            - date_trunc('day', now() at time zone ${TZ}))
    `,
  ]);
 
  return { current: toTotals(current), previous: toTotals(previous) };
}
 
/**
 * This week vs last week, clipped the same way.
 *
 * date_trunc('week', ...) starts on Monday, so early in the week this compares
 * a few hours against the same few hours last Monday — not a partial week
 * against a completed one.
 *
 * The 'week' literal stays inline rather than parameterized: passing the unit
 * into date_trunc as a bind parameter forces Postgres to infer its type.
 */
export async function getWeeklyComparison(): Promise<PeriodComparison> {
  const [current, previous] = await Promise.all([
    sql<TotalsRow[]>`
      select
        count(*) as plays,
        count(distinct track_id) as tracks,
        count(distinct artist_id) as artists,
        coalesce(sum(duration_ms), 0) as ms
      from plays
      where played_at >= (date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})
    `,
    sql<TotalsRow[]>`
      select
        count(*) as plays,
        count(distinct track_id) as tracks,
        count(distinct artist_id) as artists,
        coalesce(sum(duration_ms), 0) as ms
      from plays
      where played_at >= (date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})
                         - interval '1 week'
        and played_at <  (date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})
                         - interval '1 week'
                         + ((now() at time zone ${TZ})
                            - date_trunc('week', now() at time zone ${TZ}))
    `,
  ]);
 
  return { current: toTotals(current), previous: toTotals(previous) };
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
  detail: string;
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
  trackRows: TrackRow[],
  artistRows: ArtistRow[]
): PeriodHighlights {
  const t = trackRows[0];
  const a = artistRows[0];
  return {
    topTrack: t
      ? { id: t.id, name: t.name, detail: t.detail, art: t.art, plays: t.plays }
      : null,
    topArtist: a
      ? { id: a.id, name: a.name, detail: null, art: a.art, plays: a.plays }
      : null,
  };
}
 
export async function getTodayHighlights(): Promise<PeriodHighlights> {
  const [trackRows, artistRows] = await Promise.all([
    sql<TrackRow[]>`
      select
        track_id as id,
        -- Names can vary slightly between plays; take the most recent.
        (array_agg(track_name  order by played_at desc))[1] as name,
        (array_agg(artist_name order by played_at desc))[1] as detail,
        (array_agg(album_art   order by played_at desc))[1] as art,
        count(*)::int as plays
      from plays
      where played_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})
      group by track_id
      -- Tiebreak on earliest play so the winner is stable between renders.
      order by count(*) desc, min(played_at)
      limit 1
    `,
    sql<ArtistRow[]>`
      select
        artist_id as id,
        (array_agg(artist_name order by played_at desc))[1] as name,
        -- plays has no artist image, so borrow an album cover.
        (array_agg(album_art   order by played_at desc))[1] as art,
        count(*)::int as plays
      from plays
      where played_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})
        and artist_id <> 'unknown'
      group by artist_id
      order by count(*) desc, min(played_at)
      limit 1
    `,
  ]);
 
  return toHighlights(trackRows, artistRows);
}
 
export async function getWeekHighlights(): Promise<PeriodHighlights> {
  const [trackRows, artistRows] = await Promise.all([
    sql<TrackRow[]>`
      select
        track_id as id,
        (array_agg(track_name  order by played_at desc))[1] as name,
        (array_agg(artist_name order by played_at desc))[1] as detail,
        (array_agg(album_art   order by played_at desc))[1] as art,
        count(*)::int as plays
      from plays
      where played_at >= (date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})
      group by track_id
      order by count(*) desc, min(played_at)
      limit 1
    `,
    sql<ArtistRow[]>`
      select
        artist_id as id,
        (array_agg(artist_name order by played_at desc))[1] as name,
        (array_agg(album_art   order by played_at desc))[1] as art,
        count(*)::int as plays
      from plays
      where played_at >= (date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})
        and artist_id <> 'unknown'
      group by artist_id
      order by count(*) desc, min(played_at)
      limit 1
    `,
  ]);
 
  return toHighlights(trackRows, artistRows);
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
  const [meta, runs] = await Promise.all([
    sql<{ since: Date | null; total: string }[]>`
      select min(played_at) as since, count(*) as total from plays
    `,
    sql<{ ran_at: Date; status: string }[]>`
      select ran_at, status from ingest_runs order by ran_at desc limit 1
    `,
  ]);
 
  return {
    since: meta[0]?.since ?? null,
    totalPlays: Number(meta[0]?.total ?? 0),
    lastRunAt: runs[0]?.ran_at ?? null,
    lastRunStatus: runs[0]?.status ?? null,
  };
}
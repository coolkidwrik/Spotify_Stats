import 'server-only';
import { sql } from '@/lib/db';
 
/**
 * played_at is stored in UTC. "Today" in UTC begins at 5pm the previous day in
 * Vancouver, so every day-bounded query converts first. Getting this wrong
 * doesn't error — it just silently shifts your daily boundaries by hours.
 */
const TZ = process.env.STATS_TIMEZONE ?? 'America/Vancouver';
 
export interface DayTotals {
  plays: number;
  tracks: number;
  artists: number;
  ms: number;
}
 
/**
 * Today vs yesterday, compared over the SAME ELAPSED TIME.
 *
 * A naive comparison is useless: at 9am, today has two hours of data and
 * yesterday has twenty-four, so today always looks 90% down. This clips
 * yesterday at the same wall-clock point today has reached.
 *
 * Note ms is derived from each track's full duration — the API gives no
 * ms_played — so it counts any track you heard for 30+ seconds as complete.
 * Treat it as an upper bound.
 */
export async function getDailyComparison(): Promise<{
  today: DayTotals;
  yesterday: DayTotals;
}> {
  const rows = await sql<
    ({ bucket: string } & Record<string, string>)[]
  >`
    with p as (
      select
        played_at at time zone ${TZ} as ts,
        track_id, artist_id, duration_ms
      from plays
    ),
    b as (
      select
        date_trunc('day', now() at time zone ${TZ}) as t0,
        (now() at time zone ${TZ})
          - date_trunc('day', now() at time zone ${TZ}) as elapsed
    )
    select
      'today' as bucket,
      count(*) as plays,
      count(distinct p.track_id) as tracks,
      count(distinct p.artist_id) as artists,
      coalesce(sum(p.duration_ms), 0) as ms
    from p, b
    where p.ts >= b.t0
 
    union all
 
    select
      'yesterday',
      count(*),
      count(distinct p.track_id),
      count(distinct p.artist_id),
      coalesce(sum(p.duration_ms), 0)
    from p, b
    where p.ts >= b.t0 - interval '1 day'
      and p.ts <  b.t0 - interval '1 day' + b.elapsed
  `;
 
  const pick = (bucket: string): DayTotals => {
    const r = rows.find((x) => x.bucket === bucket);
    return {
      plays: Number(r?.plays ?? 0),
      tracks: Number(r?.tracks ?? 0),
      artists: Number(r?.artists ?? 0),
      ms: Number(r?.ms ?? 0),
    };
  };
 
  return { today: pick('today'), yesterday: pick('yesterday') };
}
 
/**
 * A completed week's report. weeksAgo = 1 is last week, 2 the week before.
 * Nothing is precomputed or stored — this is a query over the raw log, which
 * is why keeping the log means you can add new report fields retroactively.
 */
export async function getWeekReport(weeksAgo = 1) {
  const [totals] = await sql<Record<string, string>[]>`
    with b as (
      select
        date_trunc('week', now() at time zone ${TZ})
          - (${weeksAgo} * interval '1 week') as start
    )
    select
      b.start::date as week_start,
      count(*) as plays,
      count(distinct p.track_id) as tracks,
      count(distinct p.artist_id) as artists,
      coalesce(sum(p.duration_ms), 0) as ms,
      count(distinct date_trunc('day', p.played_at at time zone ${TZ})) as active_days
    from b
    left join plays p
      on p.played_at at time zone ${TZ} >= b.start
     and p.played_at at time zone ${TZ} <  b.start + interval '1 week'
    group by b.start
  `;
 
  const topTracks = await sql<Record<string, string>[]>`
    with b as (
      select
        date_trunc('week', now() at time zone ${TZ})
          - (${weeksAgo} * interval '1 week') as start
    )
    select p.track_id, p.track_name, p.artist_name, p.album_art, count(*) as plays
    from plays p, b
    where p.played_at at time zone ${TZ} >= b.start
      and p.played_at at time zone ${TZ} <  b.start + interval '1 week'
    group by 1, 2, 3, 4
    order by count(*) desc, min(p.played_at)
    limit 10
  `;
 
  const topArtists = await sql<Record<string, string>[]>`
    with b as (
      select
        date_trunc('week', now() at time zone ${TZ})
          - (${weeksAgo} * interval '1 week') as start
    )
    select p.artist_id, p.artist_name, count(*) as plays
    from plays p, b
    where p.played_at at time zone ${TZ} >= b.start
      and p.played_at at time zone ${TZ} <  b.start + interval '1 week'
    group by 1, 2
    order by count(*) desc
    limit 10
  `;
 
  return { totals, topTracks, topArtists };
}
 
/** Plays by hour of day, for the polar chart. Always returns 24 rows. */
export async function getListeningClock(days = 30) {
  return sql<{ hour: number; plays: number }[]>`
    with hours as (select generate_series(0, 23) as hour)
    select
      h.hour::int as hour,
      count(p.*)::int as plays
    from hours h
    left join plays p
      on extract(hour from p.played_at at time zone ${TZ}) = h.hour
     and p.played_at >= now() - (${days} * interval '1 day')
    group by h.hour
    order by h.hour
  `;
}
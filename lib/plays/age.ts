// Musical age derived from what was ACTUALLY played, rather than from
// Spotify's top-track rankings.
//
// The difference is real: Spotify's ranking is a black box weighted by its own
// recency and affinity logic, while this is a straight count of plays you made.
// A record you looped forty times last week weighs forty times as much here.
//
// Caveat worth knowing: release_date only exists on rows written after
// migration-002. Earlier plays have NULL and cannot be backfilled, since
// recently-played only holds the last 50 items. sampleSize reports how many
// plays actually carried a year.
 
import 'server-only';
import { sql } from '@/lib/db';
 
export interface AgeBucket {
  /** The year. */
  key: number;
  label: string;
  /** Plays of tracks released that year. */
  count: number;
  /** Share of all dated plays, 0-1. */
  share: number;
}
 
export interface AgeExtreme {
  year: number;
  name: string;
  artist: string;
  art: string | null;
}
 
export interface ListeningAge {
  /** Play-weighted median. Resists outliers better than the mean. */
  medianYear: number;
  meanYear: number;
  oldest: AgeExtreme | null;
  newest: AgeExtreme | null;
  /** Plays counted (not distinct tracks). */
  sampleSize: number;
  distinctTracks: number;
  byYear: AgeBucket[];
}
 
export const emptyListeningAge: ListeningAge = {
  medianYear: 0,
  meanYear: 0,
  oldest: null,
  newest: null,
  sampleSize: 0,
  distinctTracks: 0,
  byYear: [],
};
 
type YearRow = { year: number; plays: number; tracks: number };
type ExtremeRow = {
  year: number;
  name: string;
  artist: string;
  art: string | null;
};
 
/**
 * release_date_precision varies (year | month | day), so the column holds
 * "1975", "1975-11" or "1975-11-21". Taking the first four characters is the
 * only safe parse — casting the whole value to a date fails on the short forms.
 */
export async function getListeningAge(): Promise<ListeningAge> {
  try {
    const [years, oldestRows, newestRows] = await Promise.all([
      sql<YearRow[]>`
        select
          left(release_date, 4)::int as year,
          count(*)::int as plays,
          count(distinct track_id)::int as tracks
        from plays
        where release_date is not null
          and release_date ~ '^[0-9]{4}'
        group by 1
        having left(release_date, 4)::int between 1900 and 2100
        order by 1
      `,
      sql<ExtremeRow[]>`
        select
          left(release_date, 4)::int as year,
          (array_agg(track_name  order by played_at desc))[1] as name,
          (array_agg(artist_name order by played_at desc))[1] as artist,
          (array_agg(album_art   order by played_at desc))[1] as art
        from plays
        where release_date is not null
          and release_date ~ '^[0-9]{4}'
          and left(release_date, 4)::int between 1900 and 2100
        group by 1
        order by 1 asc
        limit 1
      `,
      sql<ExtremeRow[]>`
        select
          left(release_date, 4)::int as year,
          (array_agg(track_name  order by played_at desc))[1] as name,
          (array_agg(artist_name order by played_at desc))[1] as artist,
          (array_agg(album_art   order by played_at desc))[1] as art
        from plays
        where release_date is not null
          and release_date ~ '^[0-9]{4}'
          and left(release_date, 4)::int between 1900 and 2100
        group by 1
        order by 1 desc
        limit 1
      `,
    ]);
 
    if (!years?.length) return emptyListeningAge;
 
    const totalPlays = years.reduce((sum, r) => sum + r.plays, 0);
    const distinctTracks = years.reduce((sum, r) => sum + r.tracks, 0);
    if (!totalPlays) return emptyListeningAge;
 
    // Play-weighted median: walk the cumulative distribution to the midpoint.
    const midpoint = totalPlays / 2;
    let running = 0;
    let medianYear = years[0].year;
    for (const row of years) {
      running += row.plays;
      if (running >= midpoint) {
        medianYear = row.year;
        break;
      }
    }
 
    const meanYear = Math.round(
      years.reduce((sum, r) => sum + r.year * r.plays, 0) / totalPlays
    );
 
    // Fill gaps so a decade with no plays renders as an empty slot rather than
    // collapsing the axis and implying continuity that isn't there.
    const byYear: AgeBucket[] = [];
    const first = years[0].year;
    const last = years[years.length - 1].year;
    const lookup = new Map(years.map((r) => [r.year, r.plays]));
 
    for (let y = first; y <= last; y++) {
      const count = lookup.get(y) ?? 0;
      byYear.push({
        key: y,
        label: String(y),
        count,
        share: count / totalPlays,
      });
    }
 
    const toExtreme = (rows: ExtremeRow[] | undefined): AgeExtreme | null => {
      const r = rows?.[0];
      return r
        ? { year: r.year, name: r.name, artist: r.artist, art: r.art }
        : null;
    };
 
    return {
      medianYear,
      meanYear,
      oldest: toExtreme(oldestRows),
      newest: toExtreme(newestRows),
      sampleSize: totalPlays,
      distinctTracks,
      byYear,
    };
  } catch (err) {
    console.error('[plays] listening age failed:', err);
    return emptyListeningAge;
  }
}
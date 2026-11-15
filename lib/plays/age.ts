// Musical age from what was actually played, now reading release_date from
// the albums table rather than the denormalized column on plays.
//
// This also fixes a coverage gap: release_date was added to plays partway
// through, so earlier play rows had NULL. The backfill populated albums from
// whichever play row had the value, so plays that predate migration-002 now
// resolve a release year through their album. The sample size should jump.

import 'server-only';
import { sql } from '@/lib/db';

export interface AgeBucket {
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
  /** Plays counted, not distinct tracks. */
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
  artist: string | null;
  art: string | null;
};

/**
 * release_date_precision varies (year | month | day), so the column holds
 * "1975", "1975-11" or "1975-11-21". Taking the first four characters is the
 * only safe parse — casting the whole value to a date fails on the short forms.
 * The regex guard keeps anything malformed away from the ::int cast.
 */
export async function getListeningAge(): Promise<ListeningAge> {
  try {
    const [years, oldestRows, newestRows] = await Promise.all([
      sql<YearRow[]>`
        select
          left(al.release_date, 4)::int as year,
          count(*)::int as plays,
          count(distinct p.track_id)::int as tracks
        from plays p
        join tracks t using (track_id)
        join albums al on al.album_id = t.album_id
        where al.release_date ~ '^[0-9]{4}'
        group by 1
        having left(al.release_date, 4)::int between 1900 and 2100
        order by 1
      `,
      sql<ExtremeRow[]>`
        select
          left(al.release_date, 4)::int as year,
          t.track_name as name,
          (select string_agg(ar.artist_name, ', ' order by ta.position)
             from track_artists ta
             join artists ar using (artist_id)
            where ta.track_id = t.track_id) as artist,
          al.album_art as art
        from plays p
        join tracks t using (track_id)
        join albums al on al.album_id = t.album_id
        where al.release_date ~ '^[0-9]{4}'
          and left(al.release_date, 4)::int between 1900 and 2100
        order by 1 asc, p.played_at desc
        limit 1
      `,
      sql<ExtremeRow[]>`
        select
          left(al.release_date, 4)::int as year,
          t.track_name as name,
          (select string_agg(ar.artist_name, ', ' order by ta.position)
             from track_artists ta
             join artists ar using (artist_id)
            where ta.track_id = t.track_id) as artist,
          al.album_art as art
        from plays p
        join tracks t using (track_id)
        join albums al on al.album_id = t.album_id
        where al.release_date ~ '^[0-9]{4}'
          and left(al.release_date, 4)::int between 1900 and 2100
        order by 1 desc, p.played_at desc
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

    // Fill gaps so a year with no plays renders as an empty slot rather than
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
        ? {
            year: r.year,
            name: r.name,
            artist: r.artist ?? '',
            art: r.art,
          }
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
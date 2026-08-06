// lib/stats/musical-age.ts
import type { Track } from '@/lib/spotify/types';

export interface Bucket {
  /** Decade start (1970) or year (1974), depending on the function used. */
  key: number;
  label: string;
  count: number;
  /** Share of all dated tracks, 0–1. Use for bar heights. */
  share: number;
}

export interface MusicalAge {
  /** Headline number. Median resists outliers better than mean. */
  medianYear: number;
  meanYear: number;
  oldest: { year: number; track: Track } | null;
  newest: { year: number; track: Track } | null;
  /** Tracks that had a usable release year. */
  sampleSize: number;
  byDecade: Bucket[];
  byYear: Bucket[];
}

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function bucketize(
  years: number[],
  keyOf: (y: number) => number,
  labelOf: (k: number) => string
): Bucket[] {
  const counts = new Map<number, number>();
  for (const y of years) {
    const k = keyOf(y);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const keys = [...counts.keys()].sort((a, b) => a - b);
  if (!keys.length) return [];

  // Fill gaps so the histogram has a continuous x-axis — a decade with zero
  // tracks should render as an empty slot, not be silently skipped.
  const step = keyOf(1) === 1 ? 1 : 10;
  const filled: Bucket[] = [];
  for (let k = keys[0]; k <= keys[keys.length - 1]; k += step) {
    const count = counts.get(k) ?? 0;
    filled.push({
      key: k,
      label: labelOf(k),
      count,
      share: count / years.length,
    });
  }

  return filled;
}

export function musicalAge(tracks: Track[]): MusicalAge {
  const dated = tracks.filter((t) => Number.isFinite(t.album.releaseYear) && t.album.releaseYear > 1900);
  const years = dated.map((t) => t.album.releaseYear);

  if (!years.length) {
    return {
      medianYear: 0,
      meanYear: 0,
      oldest: null,
      newest: null,
      sampleSize: 0,
      byDecade: [],
      byYear: [],
    };
  }

  const sorted = [...years].sort((a, b) => a - b);
  const oldestTrack = dated.reduce((a, b) => (a.album.releaseYear <= b.album.releaseYear ? a : b));
  const newestTrack = dated.reduce((a, b) => (a.album.releaseYear >= b.album.releaseYear ? a : b));

  return {
    medianYear: median(sorted),
    meanYear: Math.round(years.reduce((s, y) => s + y, 0) / years.length),
    oldest: { year: oldestTrack.album.releaseYear, track: oldestTrack },
    newest: { year: newestTrack.album.releaseYear, track: newestTrack },
    sampleSize: years.length,
    byDecade: bucketize(
      years,
      (y) => Math.floor(y / 10) * 10,
      (k) => `${k}s`
    ),
    byYear: bucketize(
      years,
      (y) => y,
      (k) => String(k)
    ),
  };
}
import type { Artist } from '@/lib/spotify/types';

export interface GenreScore {
  genre: string;
  /** Raw weighted score. Higher = more dominant. */
  score: number;
  /** Score normalized against the top genre, 0–1. Use this for sizing. */
  weight: number;
  /** How many of your top artists carry this genre. */
  artistCount: number;
}

/**
 * Rank weighting: your #1 artist should count for more than your #50.
 * 1 / log2(rank + 2) gives 1.0 at rank 0 and ~0.18 at rank 49 — a meaningful
 * gradient without letting the top few artists drown out everything else.
 */
function rankWeight(index: number): number {
  return 1 / Math.log2(index + 2);
}

export function topGenres(artists: Artist[], limit = 10): GenreScore[] {
  const scores = new Map<string, { score: number; artistCount: number }>();

  artists.forEach((artist, i) => {
    const w = rankWeight(i);
    for (const genre of artist.genres) {
      const entry = scores.get(genre) ?? { score: 0, artistCount: 0 };
      entry.score += w;
      entry.artistCount += 1;
      scores.set(genre, entry);
    }
  });

  const ranked = [...scores.entries()]
    .map(([genre, v]) => ({ genre, ...v }))
    .sort((a, b) => b.score - a.score);

  const max = ranked[0]?.score ?? 1;

  return ranked.slice(0, limit).map((g) => ({
    ...g,
    weight: g.score / max,
  }));
}

/**
 * Spotify's genre taxonomy is extremely granular — you'll see "melodic drill",
 * "chamber pop", "escape room". That specificity is charming but produces a
 * long tail of near-duplicates. This collapses genres sharing a root word so
 * "indie rock", "indie pop", and "indie folk" can roll up to "indie".
 *
 * Optional. The unrolled version is usually more interesting to look at.
 */
export function rollUpGenres(
  genres: GenreScore[],
  roots: string[] = ['indie', 'rock', 'pop', 'hip hop', 'metal', 'jazz', 'house', 'techno', 'folk', 'punk'],
  limit = 8
): GenreScore[] {
  const rolled = new Map<string, GenreScore>();

  for (const g of genres) {
    const root = roots.find((r) => g.genre.includes(r)) ?? g.genre;
    const entry = rolled.get(root);
    if (entry) {
      entry.score += g.score;
      entry.artistCount += g.artistCount;
    } else {
      rolled.set(root, { ...g, genre: root });
    }
  }

  const ranked = [...rolled.values()].sort((a, b) => b.score - a.score);
  const max = ranked[0]?.score ?? 1;

  return ranked.slice(0, limit).map((g) => ({ ...g, weight: g.score / max }));
}
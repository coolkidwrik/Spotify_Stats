import type { Album, Track } from '@/lib/spotify/types';

export interface AlbumStat {
  album: Album;
  /** How many of your top tracks come from this album. */
  trackCount: number;
  /** Rank of the highest-placing track from this album (0-indexed). */
  bestRank: number;
  /** The actual tracks, in top-tracks order. */
  tracks: Track[];
}

export interface TopAlbumsOptions {
  limit?: number;
  /**
   * Singles and two-track EPs are technically albums and will otherwise fill
   * your list with one-track entries. Default excludes them.
   */
  includeSingles?: boolean;
}

export function topAlbums(
  tracks: Track[],
  { limit = 10, includeSingles = false }: TopAlbumsOptions = {}
): AlbumStat[] {
  const grouped = new Map<string, AlbumStat>();

  tracks.forEach((track, rank) => {
    if (!includeSingles && track.album.albumType === 'single') return;

    const existing = grouped.get(track.album.id);
    if (existing) {
      existing.trackCount += 1;
      existing.tracks.push(track);
      existing.bestRank = Math.min(existing.bestRank, rank);
    } else {
      grouped.set(track.album.id, {
        album: track.album,
        trackCount: 1,
        bestRank: rank,
        tracks: [track],
      });
    }
  });

  return [...grouped.values()]
    .sort((a, b) => b.trackCount - a.trackCount || a.bestRank - b.bestRank)
    .slice(0, limit);
}

/**
 * Album art for the mosaic, de-duplicated and ordered by track rank rather
 * than album track-count — visually you want your actual favourites first,
 * not whichever record you happen to have four songs from.
 */
export function mosaicArt(tracks: Track[], count = 25): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const track of tracks) {
    if (seen.has(track.album.id) || !track.album.art) continue;
    seen.add(track.album.id);
    urls.push(track.album.art);
    if (urls.length === count) break;
  }

  return urls;
}
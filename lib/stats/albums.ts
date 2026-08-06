import type { Track } from '@/lib/spotify/types';
 
/**
 * Distinct album art for the mosaic, drawn from several track lists in
 * priority order.
 *
 * Pass the most volatile source first (short_term) and a slower-moving one
 * after it (medium_term). Recent listening fills the grid; the fallback
 * guarantees a complete 5x5 even in a month where you played only 18 distinct
 * albums. Ordering is by track rank within each source, so your actual
 * favourites land in the first row.
 */
export function mosaicArt(sources: Track[][], count = 25): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
 
  for (const tracks of sources) {
    for (const track of tracks) {
      if (!track.album.art || seen.has(track.album.id)) continue;
      seen.add(track.album.id);
      urls.push(track.album.art);
      if (urls.length === count) return urls;
    }
  }
 
  return urls;
}
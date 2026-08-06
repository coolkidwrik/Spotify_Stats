// The single source of truth for which covers appear in the mosaic.
//
// layout.tsx derives the site palette from these URLs and page.tsx renders
// them. If the two ever computed their lists separately they could drift, and
// the glow would stop matching the covers producing it. Both call this.
//
// No caching needed here — getTopTracks is already cached daily and the
// dedupe is a pure loop over data that's in memory.
 
import 'server-only';
import { getTopTracks } from '@/lib/spotify/queries';
import { mosaicArt } from '@/lib/stats/albums';
 
export async function getMosaicArt(count = 25): Promise<string[]> {
  const [recent, established] = await Promise.all([
    getTopTracks('short_term'),
    getTopTracks('medium_term'),
  ]);
 
  // short_term leads so the grid turns over week to week; medium_term tops it
  // up when four weeks didn't yield 25 distinct albums.
  return mosaicArt([recent, established], count);
}
import 'server-only';
import { unstable_cache } from 'next/cache';
import { spotifyJson } from './client';
import type {
  Album,
  Artist,
  LastPlayed,
  NowPlaying,
  RawAlbum,
  RawArtist,
  RawCurrentlyPlaying,
  RawPaged,
  RawRecentlyPlayed,
  RawTrack,
  TimeRange,
  Track,
} from './types';
 
const DAY = 86_400;
const ALL_RANGES: TimeRange[] = ['short_term', 'medium_term', 'long_term'];
 
/**
 * Spotify caps top items at 50 per time range, and offset >= 50 returns an
 * empty list. Paging by 49 instead of 50 is a long-standing quirk that does
 * work, yielding roughly 100 items per range. The overlap is deduped by id.
 */
const DEEP_OFFSETS = [0, 49, 98];
 
// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------
 
function pickImage(images: { url: string }[] | undefined, i: number) {
  return images?.[i]?.url ?? images?.[0]?.url ?? null;
}
 
function toAlbum(raw: RawAlbum): Album {
  return {
    id: raw.id,
    name: raw.name,
    albumType: raw.album_type,
    totalTracks: raw.total_tracks,
    // release_date_precision may be year | month | day, so never parse as a
    // Date — "1975" and "1975-11-21" are both valid values.
    releaseYear: Number(raw.release_date.slice(0, 4)),
    art: pickImage(raw.images, 0),
    artThumb: pickImage(raw.images, 1),
    url: raw.external_urls.spotify,
  };
}
 
function toTrack(raw: RawTrack): Track {
  return {
    id: raw.id,
    name: raw.name,
    artists: raw.artists.map((a) => a.name),
    artistIds: raw.artists.map((a) => a.id),
    durationMs: raw.duration_ms,
    explicit: raw.explicit,
    album: toAlbum(raw.album),
    url: raw.external_urls.spotify,
  };
}
 
function toArtist(raw: RawArtist): Artist {
  return {
    id: raw.id,
    name: raw.name,
    genres: raw.genres ?? [],
    image: pickImage(raw.images, 0),
    imageThumb: pickImage(raw.images, 1),
    url: raw.external_urls.spotify,
  };
}
 
// ---------------------------------------------------------------------------
// Cached queries
//
// unstable_cache keys on [keyParts, ...arguments], so each (range, offset)
// combination gets its own entry. The access token never enters the key, so
// hourly token refreshes don't invalidate anything.
// ---------------------------------------------------------------------------
 
const getTopTracksPage = unstable_cache(
  async (range: TimeRange, offset: number): Promise<Track[]> => {
    const data = await spotifyJson<RawPaged<RawTrack>>(
      `/me/top/tracks?time_range=${range}&limit=50&offset=${offset}`
    );
    return data?.items.map(toTrack) ?? [];
  },
  ['spotify', 'top-tracks'],
  { revalidate: DAY, tags: ['spotify'] }
);
 
export function getTopTracks(range: TimeRange): Promise<Track[]> {
  return getTopTracksPage(range, 0);
}
 
export const getTopArtists = unstable_cache(
  async (range: TimeRange): Promise<Artist[]> => {
    const data = await spotifyJson<RawPaged<RawArtist>>(
      `/me/top/artists?time_range=${range}&limit=50`
    );
    return data?.items.map(toArtist) ?? [];
  },
  ['spotify', 'top-artists'],
  { revalidate: DAY, tags: ['spotify'] }
);
 
export const getLastPlayed = unstable_cache(
  async (): Promise<LastPlayed | null> => {
    const data = await spotifyJson<RawRecentlyPlayed>(
      '/me/player/recently-played?limit=1'
    );
    const item = data?.items?.[0];
    if (!item) return null;
    return { track: toTrack(item.track), playedAt: item.played_at };
  },
  ['spotify', 'last-played'],
  { revalidate: 300, tags: ['spotify'] }
);
 
/**
 * Every track we can reach, across all three time ranges and all reachable
 * offsets, deduped. Nine cached calls per day; typically 150-200 unique tracks.
 * Used for the release-year histogram, where a bigger sample is strictly better.
 */
export async function getDeepTrackPool(): Promise<Track[]> {
  const pages = await Promise.all(
    ALL_RANGES.flatMap((range) =>
      DEEP_OFFSETS.map((offset) => getTopTracksPage(range, offset))
    )
  );
 
  const seen = new Set<string>();
  const pool: Track[] = [];
  for (const page of pages) {
    for (const track of page) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      pool.push(track);
    }
  }
  return pool;
}
 
// ---------------------------------------------------------------------------
// Uncached — now playing is the live lane. HTTP caching happens in the route
// handler via s-maxage.
// ---------------------------------------------------------------------------
 
export async function fetchNowPlaying(): Promise<NowPlaying> {
  const empty: NowPlaying = {
    isPlaying: false,
    progressMs: null,
    durationMs: null,
    fetchedAt: Date.now(),
    track: null,
  };
 
  // Returns null on 204, which Spotify sends when nothing is playing.
  const data = await spotifyJson<RawCurrentlyPlaying>(
    '/me/player/currently-playing'
  );
  if (!data?.item || data.currently_playing_type !== 'track') return empty;
 
  return {
    isPlaying: data.is_playing,
    progressMs: data.progress_ms,
    durationMs: data.item.duration_ms,
    fetchedAt: Date.now(),
    track: toTrack(data.item),
  };
}
 
/** Everything the homepage needs, in parallel. */
export async function getAllTopData() {
  const [
    tracksShort,
    tracksMedium,
    tracksLong,
    artistsShort,
    artistsMedium,
    artistsLong,
    lastPlayed,
    deepPool,
  ] = await Promise.all([
    getTopTracks('short_term'),
    getTopTracks('medium_term'),
    getTopTracks('long_term'),
    getTopArtists('short_term'),
    getTopArtists('medium_term'),
    getTopArtists('long_term'),
    getLastPlayed(),
    getDeepTrackPool(),
  ]);
 
  return {
    tracks: {
      short_term: tracksShort,
      medium_term: tracksMedium,
      long_term: tracksLong,
    },
    artists: {
      short_term: artistsShort,
      medium_term: artistsMedium,
      long_term: artistsLong,
    },
    lastPlayed,
    deepPool,
  };
}
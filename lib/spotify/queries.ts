// lib/spotify/queries.ts
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
 
// ---------------------------------------------------------------------------
// Normalizers — raw Spotify JSON to slim app shapes.
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
// Cached queries.
//
// unstable_cache keys on [keyParts, ...arguments], so getTopTracks('short_term')
// and getTopTracks('long_term') get separate entries automatically. The access
// token never enters the key, so hourly token refreshes don't invalidate
// anything.
//
// We request limit=50 even though the UI shows 10 — the extra 40 cost nothing
// and feed the genre, album, musical-age, and mosaic derivations.
// ---------------------------------------------------------------------------
 
export const getTopTracks = unstable_cache(
  async (range: TimeRange): Promise<Track[]> => {
    const data = await spotifyJson<RawPaged<RawTrack>>(
      `/me/top/tracks?time_range=${range}&limit=50`
    );
    return data?.items.map(toTrack) ?? [];
  },
  ['spotify', 'top-tracks'],
  { revalidate: DAY, tags: ['spotify'] }
);
 
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
 
// ---------------------------------------------------------------------------
// Uncached — now playing is the live lane and must never be memoized here.
// HTTP-level caching happens in the route handler via s-maxage.
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
 
/** Convenience: every cached query the homepage needs, in parallel. */
export async function getAllTopData() {
  const [
    tracksShort,
    tracksMedium,
    tracksLong,
    artistsShort,
    artistsMedium,
    artistsLong,
    lastPlayed,
  ] = await Promise.all([
    getTopTracks('short_term'),
    getTopTracks('medium_term'),
    getTopTracks('long_term'),
    getTopArtists('short_term'),
    getTopArtists('medium_term'),
    getTopArtists('long_term'),
    getLastPlayed(),
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
  };
}
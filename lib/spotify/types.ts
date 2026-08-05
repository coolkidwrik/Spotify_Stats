// lib/spotify/types.ts
 
export type TimeRange = 'short_term' | 'medium_term' | 'long_term';
 
export const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: 'short_term', label: 'Last 4 weeks' },
  { value: 'medium_term', label: 'Last 6 months' },
  { value: 'long_term', label: 'Last year' },
];
 
// ---------------------------------------------------------------------------
// Raw Spotify shapes — only the fields we actually read.
// Deliberately omits fields removed in the Feb 2026 API changes
// (popularity, followers, preview_url, artist top-tracks).
// ---------------------------------------------------------------------------
 
export interface RawImage {
  url: string;
  height: number | null;
  width: number | null;
}
 
export interface RawSimplifiedArtist {
  id: string;
  name: string;
  external_urls: { spotify: string };
}
 
export interface RawArtist extends RawSimplifiedArtist {
  genres: string[];
  images: RawImage[];
}
 
export interface RawAlbum {
  id: string;
  name: string;
  album_type: 'album' | 'single' | 'compilation';
  total_tracks: number;
  release_date: string;
  release_date_precision: 'year' | 'month' | 'day';
  images: RawImage[];
  artists: RawSimplifiedArtist[];
  external_urls: { spotify: string };
}
 
export interface RawTrack {
  id: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  album: RawAlbum;
  artists: RawSimplifiedArtist[];
  external_urls: { spotify: string };
}
 
export interface RawPaged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}
 
export interface RawRecentlyPlayed {
  items: { track: RawTrack; played_at: string }[];
}
 
export interface RawCurrentlyPlaying {
  is_playing: boolean;
  progress_ms: number | null;
  currently_playing_type: 'track' | 'episode' | 'ad' | 'unknown';
  item: RawTrack | null;
}
 
// ---------------------------------------------------------------------------
// Slim app shapes — what the rest of the codebase sees.
// Normalizing here strips `available_markets` and other bulk we never use,
// which keeps cache entries and client payloads small.
// ---------------------------------------------------------------------------
 
export interface Album {
  id: string;
  name: string;
  albumType: 'album' | 'single' | 'compilation';
  totalTracks: number;
  releaseYear: number;
  art: string | null;
  artThumb: string | null;
  url: string;
}
 
export interface Track {
  id: string;
  name: string;
  artists: string[];
  artistIds: string[];
  durationMs: number;
  explicit: boolean;
  album: Album;
  url: string;
}
 
export interface Artist {
  id: string;
  name: string;
  genres: string[];
  image: string | null;
  imageThumb: string | null;
  url: string;
}
 
export interface LastPlayed {
  track: Track;
  playedAt: string; // ISO 8601
}
 
export interface NowPlaying {
  isPlaying: boolean;
  progressMs: number | null;
  durationMs: number | null;
  fetchedAt: number;
  track: Track | null;
}
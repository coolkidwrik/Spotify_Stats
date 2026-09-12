import 'server-only';
import { unstable_cache } from 'next/cache';
 
export interface ContextInfo {
  uri: string;
  type: string;
  name: string;
  image: string | null;
  url: string;
}
 
/**
 * Turn a context URI into a display name.
 *
 * plays stores context_uri (spotify:playlist:37i9dQ...) but Spotify sends no
 * name with it, so three different playlists all render as "Playlists" without
 * this.
 *
 * IMPORTANT: this deliberately does NOT use spotifyFetch. That helper sleeps
 * and retries on 429, so eight URIs could stall for minutes — which is very
 * likely what hung the page when this was first added. Here every request has
 * a hard AbortSignal timeout and a rate limit is simply a miss.
 */
 
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const PER_REQUEST_TIMEOUT_MS = 2500;
 
async function getToken(): Promise<string | null> {
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: process.env.SPOTIFY_REFRESH_TOKEN ?? '',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.access_token ?? null;
  } catch {
    return null;
  }
}
 
/**
 * Cached per-URI, so a new playlist appearing in your top sources doesn't
 * invalidate names already resolved. One lookup per URI per day.
 */
const resolveOne = unstable_cache(
  async (uri: string): Promise<ContextInfo | null> => {
    const [, type, id] = uri.split(':');
    if (!type || !id) return null;
 
    // Only these carry a fetchable name. collection (Liked Songs) has no
    // endpoint and falls back to a static label below.
    const path =
      type === 'playlist'
        ? `/playlists/${id}?fields=name,images,external_urls`
        : type === 'album'
          ? `/albums/${id}`
          : type === 'artist'
            ? `/artists/${id}`
            : null;
 
    if (!path) return null;
 
    const token = await getToken();
    if (!token) return null;
 
    try {
      const res = await fetch(`https://api.spotify.com/v1${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
      });
 
      // No retry on 429 — a rate limit is a miss, not a reason to sleep.
      if (!res.ok) return null;
 
      const data = (await res.json()) as {
        name?: string;
        images?: { url: string }[];
        external_urls?: { spotify: string };
      };
      if (!data.name) return null;
 
      return {
        uri,
        type,
        name: data.name,
        image: data.images?.[1]?.url ?? data.images?.[0]?.url ?? null,
        url:
          data.external_urls?.spotify ??
          `https://open.spotify.com/${type}/${id}`,
      };
    } catch {
      return null;
    }
  },
  ['spotify', 'context-name'],
  { revalidate: 86_400, tags: ['spotify'] }
);
 
const STATIC_LABELS: Record<string, string> = {
  collection: 'Liked Songs',
  show: 'Podcast',
  playlist: 'Playlist',
  album: 'Album',
  artist: 'Artist',
};
 
function fallbackFor(uri: string): ContextInfo {
  const parts = uri.split(':');
  const type = parts[1] ?? 'unknown';
  return {
    uri,
    type,
    name: STATIC_LABELS[type] ?? 'Unknown source',
    image: null,
    url: `https://open.spotify.com/${type}/${parts[parts.length - 1]}`,
  };
}
 
/**
 * Resolve many URIs. Never throws, never hangs.
 *
 * All lookups run in parallel and the whole batch is capped by budgetMs, so
 * the page render can be delayed by at most that long no matter what Spotify
 * does. Anything unresolved falls back to a generic label — the row still
 * shows its play count, which is the part that matters.
 */
export async function resolveContexts(
  uris: string[],
  budgetMs = 3000
): Promise<Map<string, ContextInfo>> {
  const map = new Map<string, ContextInfo>();
  for (const uri of uris) map.set(uri, fallbackFor(uri));
 
  if (!uris.length) return map;
 
  const lookups = Promise.allSettled(uris.map((uri) => resolveOne(uri)));
  const budget = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), budgetMs)
  );
 
  const results = await Promise.race([lookups, budget]);
  if (!results) {
    console.warn('[contexts] resolution exceeded budget; using fallbacks');
    return map;
  }
 
  results.forEach((r) => {
    if (r.status === 'fulfilled' && r.value) map.set(r.value.uri, r.value);
  });
 
  return map;
}
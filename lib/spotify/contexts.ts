// Resolves playlist/album/artist names for context URIs.
//
// Deliberately does NOT use spotifyFetch: that helper sleeps and retries on
// 429, so a handful of lookups could stall for minutes. Here every request has
// a hard AbortSignal timeout and a rate limit is simply a miss — the row keeps
// resolved_at NULL and is retried on a later run.

import 'server-only';
import { getUnresolvedContexts, saveContextInfo } from '@/lib/plays/queries';

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

interface Resolved {
  name: string | null;
  image: string | null;
}

async function lookup(uri: string, token: string): Promise<Resolved | null> {
  const [, type, id] = uri.split(':');
  if (!type || !id) return null;

  // Only these carry a fetchable name. collection (Liked Songs) has no
  // endpoint, so it gets a static name written below.
  const path =
    type === 'playlist'
      ? `/playlists/${id}?fields=name,images`
      : type === 'album'
        ? `/albums/${id}`
        : type === 'artist'
          ? `/artists/${id}`
          : null;

  if (!path) {
    const STATIC: Record<string, string> = {
      collection: 'Liked Songs',
      show: 'Podcast',
    };
    return STATIC[type] ? { name: STATIC[type], image: null } : null;
  }

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
    };
    if (!data.name) return null;

    return {
      name: data.name,
      image: data.images?.[1]?.url ?? data.images?.[0]?.url ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a batch of unresolved contexts. Called from the ingest route, so it
 * runs on the cron schedule rather than during a page render.
 *
 * Returns how many were resolved. Never throws — the caller treats this as
 * best-effort and ingestion must not depend on it.
 */
export async function resolvePendingContexts(limit = 10): Promise<number> {
  try {
    const uris = await getUnresolvedContexts(limit);
    if (!uris.length) return 0;

    const token = await getToken();
    if (!token) return 0;

    let resolved = 0;
    const results = await Promise.allSettled(
      uris.map(async (uri) => {
        const info = await lookup(uri, token);
        // Write even on a miss, so a permanently dead playlist (deleted or
        // private) stops being retried forever.
        await saveContextInfo(uri, info?.name ?? null, info?.image ?? null);
        if (info?.name) resolved++;
      })
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) console.warn(`[contexts] ${failed} lookups failed`);

    return resolved;
  } catch (err) {
    console.warn('[contexts] resolver failed:', err);
    return 0;
  }
}
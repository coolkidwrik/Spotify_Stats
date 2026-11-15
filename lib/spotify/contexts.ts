// lib/spotify/contexts.ts
//
// Resolves playlist/album/artist names for context URIs, writing into the
// contexts table. Runs on the cron schedule, not during a page render.
//
// Deliberately does NOT use spotifyFetch: that helper sleeps and retries on
// 429, so a handful of lookups could stall for minutes. Here every request has
// a hard AbortSignal timeout.
//
// IMPORTANT CHANGE from the first version: a failed lookup no longer marks the
// row resolved. The original wrote resolved_at on ANY miss so that deleted
// playlists would stop being retried — but that cannot tell "deleted" from
// "not authorized", so a missing scope permanently wrote off every playlist.
// Now only a 404 (genuinely gone) closes the row; 401/403/429/5xx leave it
// pending for the next run.

import 'server-only';
import {
  getUnresolvedContexts,
  saveContextInfo,
  markContextGone,
} from '@/lib/plays/queries';

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
    if (!res.ok) {
      console.warn(`[contexts] token refresh failed: ${res.status}`);
      return null;
    }
    const json = await res.json();
    return json.access_token ?? null;
  } catch (err) {
    console.warn('[contexts] token refresh threw:', err);
    return null;
  }
}

type Outcome =
  | { kind: 'ok'; name: string; image: string | null }
  | { kind: 'gone' } //      404 — deleted or never existed; stop retrying
  | { kind: 'retry'; status: number }; // 401/403/429/5xx — try again later

/** Endpoints with no fetchable name; resolved from a static label instead. */
const STATIC_LABELS: Record<string, string> = {
  collection: 'Liked Songs',
  show: 'Podcast',
};

async function lookup(uri: string, token: string): Promise<Outcome> {
  const [, type, id] = uri.split(':');
  if (!type || !id) return { kind: 'gone' };

  if (STATIC_LABELS[type]) {
    return { kind: 'ok', name: STATIC_LABELS[type], image: null };
  }

  const path =
    type === 'playlist'
      ? `/playlists/${id}?fields=name,images`
      : type === 'album'
        ? `/albums/${id}`
        : type === 'artist'
          ? `/artists/${id}`
          : null;

  // An unknown context type will never resolve — close it rather than
  // retrying forever.
  if (!path) return { kind: 'gone' };

  try {
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
    });

    if (res.status === 404) return { kind: 'gone' };

    // 401/403 usually means a missing scope (private playlists need
    // playlist-read-private), 429 is a rate limit, 5xx is Spotify. None of
    // those mean the playlist doesn't exist, so keep the row pending.
    if (!res.ok) return { kind: 'retry', status: res.status };

    const data = (await res.json()) as {
      name?: string;
      images?: { url: string }[];
    };
    if (!data.name) return { kind: 'retry', status: res.status };

    return {
      kind: 'ok',
      name: data.name,
      image: data.images?.[1]?.url ?? data.images?.[0]?.url ?? null,
    };
  } catch {
    // Timeout or network error — transient by definition.
    return { kind: 'retry', status: 0 };
  }
}

/**
 * Resolve a batch of unresolved contexts.
 *
 * Returns how many were named. Never throws — the caller treats this as
 * best-effort and ingestion must not depend on it.
 */
export async function resolvePendingContexts(limit = 10): Promise<number> {
  try {
    const uris = await getUnresolvedContexts(limit);
    if (!uris.length) return 0;

    const token = await getToken();
    if (!token) {
      console.warn('[contexts] no token; leaving', uris.length, 'pending');
      return 0;
    }

    let named = 0;
    const retryStatuses = new Set<number>();

    await Promise.allSettled(
      uris.map(async (uri) => {
        const outcome = await lookup(uri, token);
        if (outcome.kind === 'ok') {
          await saveContextInfo(uri, outcome.name, outcome.image);
          named++;
        } else if (outcome.kind === 'gone') {
          await markContextGone(uri);
        } else {
          // Left pending on purpose — retried next run.
          retryStatuses.add(outcome.status);
        }
      })
    );

    if (retryStatuses.size) {
      const codes = [...retryStatuses].join(', ');
      console.warn(
        `[contexts] ${uris.length - named} left pending (HTTP ${codes}). ` +
          '401/403 on playlists means the token is missing playlist-read-private.'
      );
    }

    return named;
  } catch (err) {
    console.warn('[contexts] resolver failed:', err);
    return 0;
  }
}
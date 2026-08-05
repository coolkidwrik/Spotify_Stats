// lib/spotify/client.ts
import 'server-only';
 
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
 
/** Thrown when the refresh token is expired, revoked, or misconfigured. */
export class SpotifyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotifyAuthError';
  }
}
 
let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;
 
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
 
async function requestAccessToken(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  const refresh = process.env.SPOTIFY_REFRESH_TOKEN;
 
  if (!id || !secret || !refresh) {
    throw new SpotifyAuthError(
      'Missing SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, or SPOTIFY_REFRESH_TOKEN.'
    );
  }
 
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
    cache: 'no-store',
  });
 
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
 
  if (!res.ok) {
    if (body.error === 'invalid_grant') {
      throw new SpotifyAuthError(
        'SPOTIFY_REFRESH_TOKEN is expired or revoked. Refresh tokens last ' +
          '6 months from authorization. Re-run scripts/authorize.mjs and ' +
          'update the env var locally and in Vercel.'
      );
    }
    throw new SpotifyAuthError(
      `Token refresh failed (${res.status}): ${body.error ?? 'unknown error'}`
    );
  }
 
  // Spotify may return a rotated refresh token. Surface it loudly rather than
  // failing silently in six weeks.
  if (body.refresh_token && body.refresh_token !== refresh) {
    console.warn(
      '[spotify] A new refresh token was issued. Update SPOTIFY_REFRESH_TOKEN:\n' +
        body.refresh_token
    );
  }
 
  cached = {
    token: body.access_token as string,
    expiresAt: Date.now() + (body.expires_in as number) * 1000,
  };
  return cached.token;
}
 
async function getAccessToken(): Promise<string> {
  // 60s safety margin so a token doesn't expire mid-request.
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
 
  // Collapse concurrent refreshes into one request.
  if (!inFlight) {
    inFlight = requestAccessToken().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
 
/**
 * Fetch from the Spotify Web API with auth attached.
 *
 * Caching is deliberately disabled here — the Authorization header changes
 * hourly, which would silently bust Next's fetch cache on every token refresh.
 * Caching belongs in queries.ts via unstable_cache, keyed on semantic args.
 */
export async function spotifyFetch(
  path: string,
  init: RequestInit = {},
  attempt = 0
): Promise<Response> {
  const token = await getAccessToken();
 
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
 
  // Token rejected despite our expiry math — drop it and retry once.
  if (res.status === 401 && attempt === 0) {
    cached = null;
    return spotifyFetch(path, init, attempt + 1);
  }
 
  if (res.status === 429 && attempt < 3) {
    const retryAfter = Number(res.headers.get('retry-after') ?? 1);
    await sleep(Math.min(retryAfter, 10) * 1000);
    return spotifyFetch(path, init, attempt + 1);
  }
 
  return res;
}
 
/**
 * Fetch and parse JSON. Returns null on 204 (Spotify's "nothing playing")
 * or on any non-OK response, so callers degrade instead of throwing.
 * SpotifyAuthError still propagates — that one you want to see.
 */
export async function spotifyJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T | null> {
  const res = await spotifyFetch(path, init);
 
  if (res.status === 204) return null;
 
  if (!res.ok) {
    console.error(`[spotify] GET ${path} → ${res.status}`);
    return null;
  }
 
  return (await res.json()) as T;
}
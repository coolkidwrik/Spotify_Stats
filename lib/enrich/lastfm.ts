// Last.fm tags — the primary feature source.
//
// Spotify emptied artist.genres through 2025, so community tags are the
// practical replacement, and they're richer: mood, era, scene and
// instrumentation, not just genre.
//
// Free API key from https://www.last.fm/api/account/create — set LASTFM_API_KEY.
// Without it every call returns null and the resolver records a partial
// result, so the pipeline degrades rather than breaking.
//
// Last.fm asks for roughly 5 requests/second per key. The resolver runs 20
// tracks per cron run, so that ceiling is never close.

import 'server-only';

const BASE = 'https://ws.audioscrobbler.com/2.0/';
const TIMEOUT_MS = 4000;

/**
 * Tags below this weight are noise — single-user tags, misspellings, and
 * personal labels like "songs i like". Last.fm weights are 0-100 relative to
 * the most-applied tag on that item.
 */
const MIN_WEIGHT = 15;

/** Keep the signal, drop the long tail. */
const MAX_TAGS = 12;

export interface Tag {
  tag: string;
  weight: number;
}

/**
 * Tags that describe the listener rather than the music. Last.fm is full of
 * these and they'd pollute a similarity score badly — "favorites" says
 * nothing about what a track sounds like.
 */
const JUNK_TAGS = new Set([
  'favorites',
  'favourites',
  'favorite songs',
  'seen live',
  'albums i own',
  'my music',
  'spotify',
  'under 2000 listeners',
  'check out',
  'best',
  'awesome',
  'love',
  'love it',
  'good',
  'great',
  'amazing',
  'beautiful',
  'music',
  'song',
  'songs',
  'all',
]);

function clean(raw: { name: string; count: string | number }[]): Tag[] {
  return raw
    .map((t) => ({
      tag: String(t.name).trim().toLowerCase(),
      weight: Number(t.count) || 0,
    }))
    .filter(
      (t) =>
        t.tag.length > 1 &&
        t.tag.length <= 60 &&
        t.weight >= MIN_WEIGHT &&
        !JUNK_TAGS.has(t.tag) &&
        // Tags that are just a year ("2019") add nothing — release_date
        // already covers that, more reliably.
        !/^\d{4}$/.test(t.tag)
    )
    .slice(0, MAX_TAGS);
}

async function call(params: Record<string, string>): Promise<unknown | null> {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return null;

  const qs = new URLSearchParams({
    ...params,
    api_key: key,
    format: 'json',
    autocorrect: '1', // maps misspelled names onto the canonical entry
  });

  try {
    const res = await fetch(`${BASE}?${qs}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'ckwrik-spotify-stats/1.0' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Track-level tags. Coverage is patchy for anything obscure — Last.fm only
 * has tags where users applied them — so the caller should fall back to the
 * artist's tags when this comes back thin.
 */
export async function getTrackTags(
  artist: string,
  track: string
): Promise<Tag[] | null> {
  const data = (await call({
    method: 'track.gettoptags',
    artist,
    track,
  })) as { toptags?: { tag?: unknown } } | null;

  if (!data?.toptags) return null;

  // Last.fm returns an object rather than an array when there's exactly one
  // tag, and an empty string when there are none.
  const raw = data.toptags.tag;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];

  return clean(list as { name: string; count: string | number }[]);
}

/**
 * Artist-level tags. Substantially better coverage than track-level, which is
 * why these carry most of the signal.
 */
export async function getArtistTags(artist: string): Promise<Tag[] | null> {
  const data = (await call({
    method: 'artist.gettoptags',
    artist,
  })) as { toptags?: { tag?: unknown } } | null;

  if (!data?.toptags) return null;

  const raw = data.toptags.tag;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];

  return clean(list as { name: string; count: string | number }[]);
}

export const lastfmConfigured = () => Boolean(process.env.LASTFM_API_KEY);
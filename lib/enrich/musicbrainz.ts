// MusicBrainz: ISRC -> recording MBID -> work -> lyrics language.
//
// Coverage is the honest weak point. Language lives on the WORK (the
// composition), not the recording, and most recordings are never linked to a
// work because that linking is manual editor labour. Expect 20-40% from this
// source alone, worse for recent and non-Western releases — which is exactly
// the music you'd most want it for. The caller layers tag-based and
// script-based fallbacks on top.
//
// Rate limit: 1 request per second, enforced here. A descriptive User-Agent
// with contact info is required — MusicBrainz blocks generic ones.

import 'server-only';

const BASE = 'https://musicbrainz.org/ws/2';
const TIMEOUT_MS = 5000;
const MIN_INTERVAL_MS = 1100; // 1 req/sec, with headroom

// MusicBrainz requires a real contact address. Set MUSICBRAINZ_CONTACT to an
// email or project URL; the fallback is a placeholder that may be throttled.
const UA = () =>
  `ckwrik-spotify-stats/1.0 ( ${process.env.MUSICBRAINZ_CONTACT ?? 'https://github.com/coolkidwrik'} )`;

/**
 * Serialized request gate. Module-scope state, so it holds for the life of
 * the serverless instance — which is all we need, since the resolver runs
 * sequentially within one invocation.
 */
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function get<T>(path: string): Promise<T | null> {
  await throttle();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'User-Agent': UA(), Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 503 means we've been throttled despite the gate — treat as transient.
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface RecordingInfo {
  mbid: string;
  /** ISO 639-3, from the linked work. Null when no work is linked. */
  language: string | null;
}

interface RecordingResponse {
  recordings?: {
    id: string;
    relations?: {
      type?: string;
      work?: { id: string; languages?: string[]; language?: string };
    }[];
  }[];
}

/**
 * ISRC -> recording, with its work relations in the same request.
 *
 * inc=work-rels pulls the linked work inline, so one call does what would
 * otherwise take two — worth it at 1 req/sec.
 */
export async function lookupByIsrc(isrc: string): Promise<RecordingInfo | null> {
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(isrc)) return null;

  const data = await get<RecordingResponse>(
    `/isrc/${encodeURIComponent(isrc)}?inc=work-rels&fmt=json`
  );

  const recording = data?.recordings?.[0];
  if (!recording) return null;

  // A recording can link to several works (medleys, mashups). Take the first
  // that declares a language.
  let language: string | null = null;
  for (const rel of recording.relations ?? []) {
    const w = rel.work;
    if (!w) continue;
    const lang = w.languages?.[0] ?? w.language ?? null;
    if (lang) {
      language = lang;
      break;
    }
  }

  return { mbid: recording.id, language };
}

interface ArtistSearchResponse {
  artists?: { id: string; country?: string; score?: number }[];
}

/**
 * Artist name -> MBID and country.
 *
 * Name search rather than an ID lookup, because Spotify artist IDs have no
 * MusicBrainz equivalent. That makes it fuzzy: only accept a high-confidence
 * match, or you end up attributing a country to the wrong artist entirely.
 */
export async function lookupArtist(
  name: string
): Promise<{ mbid: string; country: string | null } | null> {
  const query = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`);
  const data = await get<ArtistSearchResponse>(
    `/artist?query=${query}&limit=1&fmt=json`
  );

  const artist = data?.artists?.[0];
  if (!artist) return null;

  // MusicBrainz scores 0-100. Below ~90 the match is a guess, and a wrong
  // country is worse than no country.
  if ((artist.score ?? 0) < 90) return null;

  return { mbid: artist.id, country: artist.country ?? null };
}
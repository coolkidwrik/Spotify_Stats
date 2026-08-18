import 'server-only';
import { sql } from '@/lib/db';
import { spotifyJson } from '@/lib/spotify/client';
 
// ---------------------------------------------------------------------------
// Shapes — only the fields we read, including some the main app types omit.
// ---------------------------------------------------------------------------
 
interface IngestTrack {
  id: string | null; // null for local files
  name: string;
  duration_ms: number;
  explicit?: boolean;
  track_number?: number;
  is_local?: boolean;
  artists: { id: string | null; name: string }[];
  album?: {
    id: string | null;
    name: string;
    release_date?: string;
    images?: { url: string }[];
  };
}
 
export interface RecentlyPlayedItem {
  track: IngestTrack;
  played_at: string;
  context: { type: string; uri: string } | null;
}
 
interface PlayerState {
  is_playing: boolean;
  shuffle_state?: boolean;
  repeat_state?: string;
  device?: { type?: string; name?: string };
  item?: { id: string | null } | null;
}
 
// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------
 
/** Newest played_at already stored, as ms since epoch. */
export async function getCursor(): Promise<number | null> {
  const rows = await sql<{ cursor_ms: string | null }[]>`
    select cursor_ms from ingest_state where id = 1
  `;
  const value = rows[0]?.cursor_ms;
  return value == null ? null : Number(value);
}
 
export async function setCursor(ms: number): Promise<void> {
  await sql`
    insert into ingest_state (id, cursor_ms, updated_at)
    values (1, ${ms}, now())
    on conflict (id) do update
      set cursor_ms = excluded.cursor_ms, updated_at = now()
  `;
}
 
// ---------------------------------------------------------------------------
// Plays
// ---------------------------------------------------------------------------
 
/**
 * Batch insert, ignoring anything already stored.
 *
 * Returns the count of genuinely NEW rows — not items.length. The difference
 * is the signal you want: consistently 0 while window_size is healthy means
 * the cursor is stuck.
 */
export async function insertPlays(
  items: RecentlyPlayedItem[]
): Promise<number> {
  if (!items.length) return 0;
 
  const rows = items
    // A local file has no stable id, so it can't participate in the composite
    // primary key. Rare, and not worth a synthetic id.
    .filter((item) => item.track?.id)
    .map((item) => {
      const t = item.track;
      return {
        played_at: item.played_at,
        track_id: t.id as string,
        track_name: t.name,
        // Primary artist for cheap grouping; all_artist_ids for "did I hear X
        // at all", which primary-only would miss on features.
        artist_id: t.artists[0]?.id ?? 'unknown',
        artist_name: t.artists.map((a) => a.name).join(', '),
        all_artist_ids: t.artists.map((a) => a.id).filter(Boolean) as string[],
        album_id: t.album?.id ?? null,
        album_name: t.album?.name ?? null,
        album_art: t.album?.images?.[1]?.url ?? null,
        // Stored raw: precision varies (year | month | day).
        release_date: t.album?.release_date ?? null,
        track_number: t.track_number ?? null,
        duration_ms: t.duration_ms,
        // ?? null rather than ?? false — a missing field should not be
        // recorded as a confident "not explicit".
        explicit: t.explicit ?? null,
        context_type: item.context?.type ?? null,
        context_uri: item.context?.uri ?? null,
        is_local: t.is_local ?? false,
      };
    });
 
  if (!rows.length) return 0;
 
  const inserted = await sql`
    insert into plays ${sql(
      rows,
      'played_at',
      'track_id',
      'track_name',
      'artist_id',
      'artist_name',
      'all_artist_ids',
      'album_id',
      'album_name',
      'album_art',
      'release_date',
      'track_number',
      'duration_ms',
      'explicit',
      'context_type',
      'context_uri',
      'is_local'
    )}
    on conflict (played_at, track_id) do nothing
    returning track_id
  `;
 
  return inserted.length;
}
 
// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------
 
/**
 * Sample the player. Device type, shuffle and repeat exist ONLY here —
 * recently-played carries none of them, so the only way to capture them is to
 * catch the player mid-play.
 *
 * This is a sample, not a log. Each run sees one instant and misses everything
 * between runs, so device and shuffle figures are proportions over samples,
 * never over plays. Best-effort: a failure here must not fail ingestion.
 */
export async function samplePlayerState(): Promise<boolean> {
  try {
    // Returns null on 204, which Spotify sends when nothing is active.
    const state = await spotifyJson<PlayerState>('/me/player');
    if (!state) return false;
 
    await sql`
      insert into player_samples
        (sampled_at, is_playing, track_id, device_type, device_name, shuffle, repeat_state)
      values (
        now(),
        ${state.is_playing ?? false},
        ${state.item?.id ?? null},
        ${state.device?.type ?? null},
        ${state.device?.name ?? null},
        ${state.shuffle_state ?? null},
        ${state.repeat_state ?? null}
      )
      on conflict (sampled_at) do nothing
    `;
    return true;
  } catch (err) {
    console.warn('[ingest] player sample failed:', err);
    return false;
  }
}
 
// ---------------------------------------------------------------------------
 
/** For the "listening data last updated N ago" indicator. */
export async function getIngestHealth() {
  const rows = await sql<
    { ran_at: Date; status: string; inserted: number; window_size: number }[]
  >`
    select ran_at, status, inserted, window_size
    from ingest_runs
    order by ran_at desc
    limit 1
  `;
  return rows[0] ?? null;
}
import 'server-only';
import { sql } from '@/lib/db';
import type { RawTrack } from '@/lib/spotify/types';
 
export interface RecentlyPlayedItem {
  track: RawTrack;
  played_at: string;
  context: { type: string } | null;
}
 
/** Newest played_at we've already stored, as ms since epoch. */
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
 
/**
 * Batch insert, ignoring anything already stored.
 *
 * Returns the number of genuinely new rows — not items.length. The difference
 * is the signal you want: if this is consistently 0 while window_size is
 * healthy, the cursor is stuck.
 */
export async function insertPlays(
  items: RecentlyPlayedItem[]
): Promise<number> {
  if (!items.length) return 0;
 
  const rows = items.map((item) => ({
    played_at: item.played_at,
    track_id: item.track.id,
    track_name: item.track.name,
    // Store the joined credit rather than only the primary artist, so display
    // doesn't need a second lookup. artist_id stays the primary for grouping.
    artist_id: item.track.artists[0]?.id ?? 'unknown',
    artist_name: item.track.artists.map((a) => a.name).join(', '),
    album_id: item.track.album?.id ?? null,
    album_art: item.track.album?.images?.[1]?.url ?? null,
    duration_ms: item.track.duration_ms,
    context_type: item.context?.type ?? null,
  }));
 
  const inserted = await sql`
    insert into plays ${sql(
      rows,
      'played_at',
      'track_id',
      'track_name',
      'artist_id',
      'artist_name',
      'album_id',
      'album_art',
      'duration_ms',
      'context_type'
    )}
    on conflict (played_at, track_id) do nothing
    returning track_id
  `;
 
  return inserted.length;
}
 
/** For the "listening data last updated N ago" indicator on the site. */
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
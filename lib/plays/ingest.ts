import 'server-only';
import { sql } from '@/lib/db';
import { spotifyJson } from '@/lib/spotify/client';

// ---------------------------------------------------------------------------
// Shapes — only the fields we read.
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
  const value = rows?.[0]?.cursor_ms;
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

/** De-duplicate a list of objects by a key, keeping the first occurrence. */
function uniqueBy<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

/**
 * Batch insert, ignoring anything already stored.
 *
 * Returns the count of genuinely NEW play rows — not items.length. The
 * difference is the signal you want: consistently 0 while window_size is
 * healthy means the cursor is stuck.
 *
 * Order matters. Parents before children, so the foreign keys always resolve:
 *   albums → artists → tracks → track_artists → contexts → plays
 * All of it in one transaction, so a mid-batch failure leaves nothing partial.
 */
export async function insertPlays(
  items: RecentlyPlayedItem[]
): Promise<number> {
  if (!items.length) return 0;

  // A local file has no stable id, so it can't participate in the composite
  // primary key. Rare, and not worth a synthetic id.
  const usable = items.filter((item) => item.track?.id);
  if (!usable.length) return 0;

  // --- Build the row sets -------------------------------------------------

  const albumRows = uniqueBy(
    usable
      .filter((i) => i.track.album?.id)
      .map((i) => ({
        album_id: i.track.album!.id as string,
        album_name: i.track.album!.name ?? null,
        album_art: i.track.album!.images?.[1]?.url ?? null,
        release_date: i.track.album!.release_date ?? null,
      })),
    (r) => r.album_id
  );

  const artistRows = uniqueBy(
    usable.flatMap((i) =>
      i.track.artists
        .filter((a) => a.id)
        .map((a) => ({ artist_id: a.id as string, artist_name: a.name }))
    ),
    (r) => r.artist_id
  );

  const trackRows = uniqueBy(
    usable.map((i) => ({
      track_id: i.track.id as string,
      track_name: i.track.name,
      album_id: i.track.album?.id ?? null,
      duration_ms: i.track.duration_ms,
      explicit: i.track.explicit ?? null,
      track_number: i.track.track_number ?? null,
      is_local: i.track.is_local ?? false,
    })),
    (r) => r.track_id
  );

  const creditRows = uniqueBy(
    usable.flatMap((i) =>
      i.track.artists
        .filter((a) => a.id)
        .map((a, index) => ({
          track_id: i.track.id as string,
          artist_id: a.id as string,
          position: index,
        }))
    ),
    (r) => `${r.track_id}:${r.artist_id}`
  );

  const contextRows = uniqueBy(
    usable
      .filter((i) => i.context?.uri)
      .map((i) => ({
        context_uri: i.context!.uri,
        // Derive from the URI rather than trusting context.type — the two are
        // the same fact, and the URI is the one we key on.
        context_type: i.context!.uri.split(':')[1] ?? i.context!.type,
      })),
    (r) => r.context_uri
  );

  const playRows = usable.map((i) => {
    const t = i.track;
    return {
      played_at: i.played_at,
      track_id: t.id as string,
      context_type: i.context?.type ?? null,
      context_uri: i.context?.uri ?? null,

      // --- Legacy columns, still written during the dual-write phase -------
      track_name: t.name,
      artist_id: t.artists[0]?.id ?? 'unknown',
      artist_name: t.artists.map((a) => a.name).join(', '),
      all_artist_ids: t.artists.map((a) => a.id).filter(Boolean) as string[],
      album_id: t.album?.id ?? null,
      album_name: t.album?.name ?? null,
      album_art: t.album?.images?.[1]?.url ?? null,
      release_date: t.album?.release_date ?? null,
      track_number: t.track_number ?? null,
      duration_ms: t.duration_ms,
      explicit: t.explicit ?? null,
      is_local: t.is_local ?? false,
    };
  });

  // --- Write, parents first -----------------------------------------------

  let inserted = 0;

  await sql.begin(async (tx) => {
    if (albumRows.length) {
      await tx`
        insert into albums ${tx(
          albumRows,
          'album_id',
          'album_name',
          'album_art',
          'release_date'
        )}
        on conflict (album_id) do update set
          album_name   = coalesce(excluded.album_name,   albums.album_name),
          album_art    = coalesce(excluded.album_art,    albums.album_art),
          release_date = coalesce(excluded.release_date, albums.release_date)
      `;
    }

    if (artistRows.length) {
      // do update, not do nothing: this is what corrects the '(unresolved)'
      // placeholder rows the backfill created for featured artists.
      await tx`
        insert into artists ${tx(artistRows, 'artist_id', 'artist_name')}
        on conflict (artist_id) do update
          set artist_name = excluded.artist_name
      `;
    }

    if (trackRows.length) {
      await tx`
        insert into tracks ${tx(
          trackRows,
          'track_id',
          'track_name',
          'album_id',
          'duration_ms',
          'explicit',
          'track_number',
          'is_local'
        )}
        on conflict (track_id) do update set
          track_name   = excluded.track_name,
          album_id     = coalesce(excluded.album_id,     tracks.album_id),
          explicit     = coalesce(excluded.explicit,     tracks.explicit),
          track_number = coalesce(excluded.track_number, tracks.track_number)
      `;
    }

    if (creditRows.length) {
      await tx`
        insert into track_artists ${tx(
          creditRows,
          'track_id',
          'artist_id',
          'position'
        )}
        on conflict (track_id, artist_id) do update
          set position = excluded.position
      `;
    }

    if (contextRows.length) {
      // do nothing: never clobber a resolved name/image with a bare type.
      await tx`
        insert into contexts ${tx(contextRows, 'context_uri', 'context_type')}
        on conflict (context_uri) do nothing
      `;
    }

    const result = await tx`
      insert into plays ${tx(
        playRows,
        'played_at',
        'track_id',
        'context_type',
        'context_uri',
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
        'is_local'
      )}
      on conflict (played_at, track_id) do nothing
      returning track_id
    `;

    inserted = result.length;
  });

  return inserted;
}

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------

/**
 * Sample the player. Device type, shuffle and repeat exist ONLY here —
 * recently-played carries none of them.
 *
 * A sample, not a log: each run sees one instant and misses everything
 * between runs, so these are proportions over samples, never over plays.
 * Best-effort — a failure here must not fail ingestion.
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
  return rows?.[0] ?? null;
}
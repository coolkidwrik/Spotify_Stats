-- schema.sql — the complete current schema, for a fresh install.
--
-- Create order matters: parents before children, or the foreign keys fail.


-- ===========================================================================
-- REFERENCE DATA — one row per real-world thing, not per play
-- ===========================================================================

-- Albums --------------------------------------------------------------------
create table if not exists albums (
  album_id     text primary key,
  album_name   text,
  album_art    text,
  -- Text, not date. Spotify's release_date_precision varies between year,
  -- month and day, so the value may be "1975", "1975-11" or "1975-11-21".
  -- A date cast fails on the first two; parse with left(release_date, 4).
  release_date text
);

-- Artists -------------------------------------------------------------------
create table if not exists artists (
  artist_id   text primary key,
  artist_name text not null
);

-- Tracks --------------------------------------------------------------------
create table if not exists tracks (
  track_id     text primary key,
  track_name   text not null,
  album_id     text references albums(album_id),
  duration_ms  integer not null,
  -- Nullable: NULL means "written before this column existed", which is
  -- different from false. A `where explicit` filter treats NULL as not-true,
  -- so unknown rows drop out of explicit counts rather than skewing them.
  explicit     boolean,
  track_number smallint,
  is_local     boolean not null default false,
  first_seen   timestamptz not null default now()
);

create index if not exists tracks_album_idx on tracks (album_id);

-- Track/artist credits ------------------------------------------------------
-- Replaces the old all_artist_ids array, which was a repeating group inside a
-- single cell (not 1NF) and carried IDs with no names.
--
-- position 0 is the primary credit. The display string ("A, B feat. C") is
-- DERIVED by ordering, never stored — the denormalized schema stored the
-- joined credit in plays.artist_name while plays.artist_id held only the
-- primary, so grouping by artist could render "A, B" for a solo artist.
create table if not exists track_artists (
  track_id  text not null references tracks(track_id) on delete cascade,
  artist_id text not null references artists(artist_id),
  position  smallint not null default 0,
  primary key (track_id, artist_id)
);

create index if not exists track_artists_artist_idx on track_artists (artist_id);

-- Contexts ------------------------------------------------------------------
-- Where a play was started from: a playlist, album, or artist page.
--
-- context_type is a functional dependency of the URI (spotify:playlist:... is
-- always type "playlist"), which is why it lives here rather than on plays —
-- storing both there was a 3NF violation and allowed them to disagree.
--
-- name and image_url are a CACHE of Spotify state, not a schema dependency.
-- They replace what used to be a per-request API lookup during page render;
-- resolved_at makes the staleness explicit.
--
-- IMPORTANT: store the canonical URI only. Spotify sometimes appends session
-- parameters (spotify:playlist:ABC?sessionId=1790899200002&...), and since
-- sessionId changes per listening session, an unstripped URI creates a new row
-- periodically and splits that playlist's plays across all of them. The ingest
-- truncates at '?'.
create table if not exists contexts (
  context_uri  text primary key,
  context_type text not null,
  name         text,
  image_url    text,
  -- NULL = never looked up. Set with a name on success; set WITHOUT a name
  -- only on a 404 (genuinely gone). Transient failures — 401/403/429/5xx —
  -- must leave this NULL so the resolver retries. Spotify's own algorithmic
  -- playlists (ID prefix 37i9dQZF1E: Daily Mix, Discover Weekly, Radio) became
  -- inaccessible to the Web API in Nov 2024 and permanently 404, so they end
  -- up here with resolved_at set and name NULL.
  resolved_at  timestamptz
);

-- Partial index: the resolver only ever queries for pending rows.
create index if not exists contexts_unresolved_idx
  on contexts (context_uri) where resolved_at is null;


-- ===========================================================================
-- THE LOG — one row per play, holding only what varies per play
-- ===========================================================================

-- Append-only. Never wiped.
--
-- Three columns. Everything else about the track, album, artists and context
-- lives in the reference tables above, so a track played 200 times stores its
-- metadata once rather than 200 times.
--
-- ~50 plays/day is ~18k rows/year, a couple of MB against a 500MB free tier.
create table if not exists plays (
  played_at   timestamptz not null,
  track_id    text not null references tracks(track_id),
  context_uri text references contexts(context_uri),

  -- The composite key is the idempotency mechanism. A retry, a double-fire,
  -- or a lost cursor are all no-ops: re-inserting the same play does nothing.
  -- You could re-fetch the last 50 items every run and the table stays clean.
  primary key (played_at, track_id)
);

create index if not exists plays_played_at_idx on plays (played_at desc);
create index if not exists plays_track_idx     on plays (track_id);
create index if not exists plays_context_idx
  on plays (context_uri) where context_uri is not null;

-- QUERY RULE: never apply a function to played_at in a WHERE clause.
-- Convert the boundary instead.
--
--   BAD   where played_at at time zone TZ >= date_trunc('day', ...)
--         -> function on the indexed column; sequential scan with a per-row
--            timezone conversion
--
--   GOOD  where played_at >= (date_trunc('day', now() at time zone TZ)
--                             at time zone TZ)
--         -> raw column vs constant; the index applies


-- ===========================================================================
-- OPERATIONAL — describes the ingest process, not the music
-- ===========================================================================

-- Single-row watermark: the newest played_at already stored.
-- A bandwidth optimisation, not a correctness mechanism — see the plays
-- primary key. Deleting this table loses nothing but some API payload.
create table if not exists ingest_state (
  id         smallint primary key default 1 check (id = 1),
  cursor_ms  bigint,
  updated_at timestamptz not null default now()
);

-- Audit trail, one row per cron run. The pipeline fails silently otherwise:
-- if the scheduler stops, the token expires, or the database pauses, plays
-- simply stop accumulating with no error anywhere.
--
-- window_size is how many items the API returned. recently-played holds only
-- the last 50 (~2.5 hours of listening), so a consistent 50 means the buffer
-- saturated and plays were dropped between runs.
create table if not exists ingest_runs (
  ran_at      timestamptz primary key default now(),
  status      text not null check (status in ('ok', 'error')),
  inserted    integer not null default 0,
  window_size integer not null default 0,
  error       text
);

create index if not exists ingest_runs_recent_idx on ingest_runs (ran_at desc);

-- Player state, sampled once per cron run.
--
-- A SAMPLE, not a log: each run captures one instant and misses everything
-- between runs. Device and shuffle figures are proportions over samples, never
-- over plays — never join this to plays as though it were complete.
--
-- Requires the user-read-playback-state scope; without it /me/player returns
-- 401 and this stays empty.
create table if not exists player_samples (
  sampled_at   timestamptz primary key default now(),
  is_playing   boolean not null,
  track_id     text,
  device_type  text,
  device_name  text,
  shuffle      boolean,
  repeat_state text
);

create index if not exists player_samples_recent_idx
  on player_samples (sampled_at desc);


-- ===========================================================================
-- ROW LEVEL SECURITY
-- ===========================================================================

-- Zero policies = no PostgREST access at all. The postgres role used by
-- DATABASE_URL bypasses RLS, so the app is unaffected. Without this, anyone
-- holding the anon key — which ships in browsers — could read the lot.
alter table albums         enable row level security;
alter table artists        enable row level security;
alter table tracks         enable row level security;
alter table track_artists  enable row level security;
alter table contexts       enable row level security;
alter table plays          enable row level security;
alter table ingest_state   enable row level security;
alter table ingest_runs    enable row level security;
alter table player_samples enable row level security;
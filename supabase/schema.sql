-- These tables are only ever touched server-side through DATABASE_URL, never
-- via the anon key, so PostgREST/RLS is not in the picture. Don't expose them
-- through the Supabase API.
 
-- Append-only log of every track play. Never wiped.
-- ~50 plays/day is ~18k rows and ~5MB per year against a 500MB free tier.
create table if not exists plays (
  played_at      timestamptz not null,
  track_id       text        not null,
  track_name     text        not null,
  artist_id      text        not null,
  artist_name    text        not null,
  all_artist_ids text[],
  album_id       text,
  album_name     text,
  album_art      text,
  duration_ms    integer     not null,
  -- Nullable: NULL means "written before the explicit column existed", which
  -- is different from false.
  explicit       boolean,
  context_type   text,
  context_uri    text,
  -- Precision varies (year | month | day), so text, parsed with left(...,4).
  release_date   text,
  track_number   smallint,
  is_local       boolean     not null default false,
 
  -- The composite key is the idempotency mechanism. A retry, a double-fire,
  -- or a lost cursor all become no-ops. You could re-fetch the last 50 items
  -- every run and the table would stay clean.
  primary key (played_at, track_id)
);
 
create index if not exists plays_played_at_idx on plays (played_at desc);
create index if not exists plays_artist_idx    on plays (artist_id);
create index if not exists plays_track_idx     on plays (track_id);
create index if not exists plays_context_idx
  on plays (context_uri) where context_uri is not null;
 
-- Single-row watermark: newest played_at already stored.
-- A bandwidth optimisation, not a correctness mechanism — see the primary key.
create table if not exists ingest_state (
  id         smallint primary key default 1 check (id = 1),
  cursor_ms  bigint,
  updated_at timestamptz not null default now()
);
 
-- Audit trail. window_size is how many items the API returned: a consistent
-- 50 means the buffer saturated and plays were dropped.
create table if not exists ingest_runs (
  ran_at      timestamptz primary key default now(),
  status      text not null check (status in ('ok', 'error')),
  inserted    integer not null default 0,
  window_size integer not null default 0,
  error       text
);
 
create index if not exists ingest_runs_recent_idx on ingest_runs (ran_at desc);
 
-- Player state, sampled once per cron run. A SAMPLE, not a log: it captures
-- that instant only and misses everything between runs. Treat device and
-- shuffle stats as proportions over samples, never over plays.
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

alter table plays        enable row level security;
alter table ingest_state enable row level security;
alter table ingest_runs  enable row level security;
alter table player_samples enable row level security;
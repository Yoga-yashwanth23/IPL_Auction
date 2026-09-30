-- ============================================================================
-- IPL OCEAN AUCTION — SCHEMA
-- Run this once in Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: drops nothing, uses IF NOT EXISTS everywhere it can.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 2. USERS  (operator/admin accounts — extends auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique not null,
  display_name text,
  role text not null default 'operator' check (role in ('admin', 'operator', 'viewer')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. TEAMS
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                 -- MI, CSK, RCB, KKR, SRH, RR, DC, PBKS, GT, LSG
  name text not null,
  logo_url text,
  primary_color text default '#1FB6AC',
  purse_total numeric(12, 2) not null default 10000,   -- ₹ Lakh — 10000 = ₹100 Cr (see src/lib/utils.ts formatCr)
  purse_remaining numeric(12, 2) not null default 10000, -- ₹ Lakh
  squad_size_limit int not null default 25,
  squad_size_min int not null default 18,
  overseas_limit int not null default 8,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_teams_code on public.teams (code);

-- ---------------------------------------------------------------------------
-- 4. PLAYERS  (master dataset — never hard-coded, always imported)
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  external_player_id text not null,          -- player_id from the uploaded dataset
  name text not null,
  country text,
  country_code text,
  role text,                                  -- Batter / Bowler / All-rounder / WK
  category text,                              -- Capped / Uncapped (source dataset column)
  base_price numeric(12, 2) not null default 0, -- ₹ Lakh — e.g. 50 = ₹50 L, 200 = ₹2 Cr
  age int,
  batting_style text,
  bowling_style text,
  stats jsonb default '{}'::jsonb,
  -- Mega Auction set-sequencing columns — derived by src/features/auction/auctionSets.ts
  -- at import time (see commitImport.ts). Never hand-edit discipline/capped_status/set_code/
  -- set_order directly; re-import (or re-run the derivation) if role/category/bowling_style change.
  discipline text check (discipline in ('BA', 'AR', 'WK', 'FA', 'SP')),
  capped_status text check (capped_status in ('Capped', 'Uncapped')),
  is_marquee boolean not null default false,   -- auction-committee call, set explicitly — never inferred
  set_code text check (set_code in ('M1', 'M2', 'BA', 'AR', 'WK', 'FA', 'SP', 'UBA', 'UAR', 'UWK', 'UFA', 'USP')),
  set_order int,                                -- 1–12, fixed running order (see auctionSets.ts)
  image_filename text,
  image_url text,
  image_status text not null default 'missing' check (image_status in ('matched', 'missing', 'needs_review')),
  is_duplicate boolean not null default false,
  duplicate_of uuid references public.players (id) on delete set null,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_player_id)
);

create index if not exists idx_players_name on public.players using gin (to_tsvector('simple', name));
create index if not exists idx_players_role on public.players (role);
create index if not exists idx_players_country on public.players (country);
create index if not exists idx_players_image_status on public.players (image_status);
create index if not exists idx_players_import_batch on public.players (import_batch_id);
create index if not exists idx_players_set_order on public.players (set_order);
create index if not exists idx_players_set_code on public.players (set_code);

-- If you already ran this schema before the Mega Auction set columns were added, this
-- backfills them on an existing table without touching any other column.
alter table public.players add column if not exists discipline text;
alter table public.players add column if not exists capped_status text;
alter table public.players add column if not exists is_marquee boolean not null default false;
alter table public.players add column if not exists set_code text;
alter table public.players add column if not exists set_order int;

-- ---------------------------------------------------------------------------
-- 5. AUCTIONS  (a configured auction "run")
-- ---------------------------------------------------------------------------
create table if not exists public.auctions (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'IPL Mock Auction',
  status text not null default 'ready' check (status in ('ready', 'live', 'bidding', 'completed', 'ended')),
  current_auction_player_id uuid,             -- fk added below (circular) after auction_players exists
  current_bid numeric(12, 2) default 0,
  current_increment numeric(12, 2) not null default 25,   -- e.g. 0.25 Cr expressed in your base unit
  highest_bidder_team_id uuid references public.teams (id) on delete set null,
  timer_seconds int not null default 30,
  timer_remaining int not null default 30,
  timer_status text not null default 'stopped' check (timer_status in ('running', 'paused', 'stopped')),
  default_increment_options numeric(12,2)[] not null default array[25, 50, 100],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If you already ran this schema before the 'ended' status was added (End Auction /
-- Resume / Start New Auction feature), widen the existing check constraint so it
-- accepts the new value without touching any data.
alter table public.auctions drop constraint if exists auctions_status_check;
alter table public.auctions
  add constraint auctions_status_check check (status in ('ready', 'live', 'bidding', 'completed', 'ended'));

-- ---------------------------------------------------------------------------
-- 6. AUCTION_PLAYERS  (a player queued into a specific auction, with order + outcome)
-- ---------------------------------------------------------------------------
create table if not exists public.auction_players (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  order_index int not null,
  status text not null default 'pending' check (status in ('pending', 'live', 'sold', 'unsold', 're_auction')),
  final_price numeric(12, 2),
  sold_to_team_id uuid references public.teams (id) on delete set null,
  re_auction_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auction_id, player_id),
  unique (auction_id, order_index)
);

create index if not exists idx_auction_players_auction on public.auction_players (auction_id, order_index);
create index if not exists idx_auction_players_status on public.auction_players (auction_id, status);

-- now that auction_players exists, wire the circular FK from auctions
alter table public.auctions
  add constraint fk_auctions_current_player
  foreign key (current_auction_player_id) references public.auction_players (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 7. BIDS  (every bid placed — full history, drives Undo)
-- ---------------------------------------------------------------------------
create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions (id) on delete cascade,
  auction_player_id uuid not null references public.auction_players (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  amount numeric(12, 2) not null,
  increment_used numeric(12, 2) not null,
  placed_by uuid references public.users (id) on delete set null,
  is_undone boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_bids_auction_player on public.bids (auction_player_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 8. PURCHASES  (finalized sales — one row per SOLD player)
-- ---------------------------------------------------------------------------
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions (id) on delete cascade,
  auction_player_id uuid not null references public.auction_players (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  price numeric(12, 2) not null,
  is_overseas boolean not null default false,
  created_at timestamptz not null default now(),
  unique (auction_player_id)
);

create index if not exists idx_purchases_team on public.purchases (auction_id, team_id);

-- ---------------------------------------------------------------------------
-- 9. TEAM_SQUADS  (denormalized live roster per team per auction — fast reads for /display)
-- ---------------------------------------------------------------------------
create table if not exists public.team_squads (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  price numeric(12, 2) not null,
  is_overseas boolean not null default false,
  created_at timestamptz not null default now(),
  unique (auction_id, team_id, player_id)
);

create index if not exists idx_team_squads_team on public.team_squads (auction_id, team_id);

-- ---------------------------------------------------------------------------
-- 10. AUCTION_EVENTS  (append-only event log — powers Undo, History, Analytics)
-- ---------------------------------------------------------------------------
create table if not exists public.auction_events (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions (id) on delete cascade,
  event_type text not null,   -- 'player_selected' | 'bid_placed' | 'bid_undone' | 'sold' | 'unsold' | 're_auction' | 'timer_paused' | ...
  auction_player_id uuid references public.auction_players (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  payload jsonb default '{}'::jsonb,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_auction_events_auction on public.auction_events (auction_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 11. updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  foreach t in array array['teams', 'players', 'auctions', 'auction_players'] loop
    execute format(
      'drop trigger if exists trg_set_updated_at on public.%I; create trigger trg_set_updated_at before update on public.%I for each row execute function public.set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- Model: anyone (including anon, for the public /display screen) can READ.
-- Only authenticated users listed in public.users with role admin/operator
-- can WRITE. Adjust to taste once you add real auth.
-- ============================================================================

alter table public.users enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.auctions enable row level security;
alter table public.auction_players enable row level security;
alter table public.bids enable row level security;
alter table public.purchases enable row level security;
alter table public.team_squads enable row level security;
alter table public.auction_events enable row level security;

create or replace function public.is_operator()
returns boolean as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin', 'operator')
  );
$$ language sql stable security definer;

-- users: a user can read their own row; operators can read all
drop policy if exists "users_select" on public.users;
create policy "users_select" on public.users for select
  using (auth.uid() = id or public.is_operator());

drop policy if exists "users_upsert_self" on public.users;
create policy "users_upsert_self" on public.users for insert
  with check (auth.uid() = id);

-- public read policies (anon + authenticated) for everything the display/operator needs to show
drop policy if exists "teams_read_all" on public.teams;
create policy "teams_read_all" on public.teams for select using (true);

drop policy if exists "players_read_all" on public.players;
create policy "players_read_all" on public.players for select using (true);

drop policy if exists "auctions_read_all" on public.auctions;
create policy "auctions_read_all" on public.auctions for select using (true);

drop policy if exists "auction_players_read_all" on public.auction_players;
create policy "auction_players_read_all" on public.auction_players for select using (true);

drop policy if exists "bids_read_all" on public.bids;
create policy "bids_read_all" on public.bids for select using (true);

drop policy if exists "purchases_read_all" on public.purchases;
create policy "purchases_read_all" on public.purchases for select using (true);

drop policy if exists "team_squads_read_all" on public.team_squads;
create policy "team_squads_read_all" on public.team_squads for select using (true);

drop policy if exists "auction_events_read_all" on public.auction_events;
create policy "auction_events_read_all" on public.auction_events for select using (true);

-- write policies: operator-only
drop policy if exists "teams_write_operator" on public.teams;
create policy "teams_write_operator" on public.teams for all
  using (public.is_operator()) with check (public.is_operator());

drop policy if exists "players_write_operator" on public.players;
create policy "players_write_operator" on public.players for all
  using (public.is_operator()) with check (public.is_operator());

drop policy if exists "auctions_write_operator" on public.auctions;
create policy "auctions_write_operator" on public.auctions for all
  using (public.is_operator()) with check (public.is_operator());

drop policy if exists "auction_players_write_operator" on public.auction_players;
create policy "auction_players_write_operator" on public.auction_players for all
  using (public.is_operator()) with check (public.is_operator());

drop policy if exists "bids_write_operator" on public.bids;
create policy "bids_write_operator" on public.bids for all
  using (public.is_operator()) with check (public.is_operator());

drop policy if exists "purchases_write_operator" on public.purchases;
create policy "purchases_write_operator" on public.purchases for all
  using (public.is_operator()) with check (public.is_operator());

drop policy if exists "team_squads_write_operator" on public.team_squads;
create policy "team_squads_write_operator" on public.team_squads for all
  using (public.is_operator()) with check (public.is_operator());

drop policy if exists "auction_events_write_operator" on public.auction_events;
create policy "auction_events_write_operator" on public.auction_events for all
  using (public.is_operator()) with check (public.is_operator());

-- ============================================================================
-- STORAGE — bucket for player photos + team logos
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('player-images', 'player-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('team-logos', 'team-logos', true)
on conflict (id) do nothing;

drop policy if exists "player_images_read" on storage.objects;
create policy "player_images_read" on storage.objects for select
  using (bucket_id = 'player-images');

drop policy if exists "player_images_write_operator" on storage.objects;
create policy "player_images_write_operator" on storage.objects for all
  using (bucket_id = 'player-images' and public.is_operator())
  with check (bucket_id = 'player-images' and public.is_operator());

drop policy if exists "team_logos_read" on storage.objects;
create policy "team_logos_read" on storage.objects for select
  using (bucket_id = 'team-logos');

drop policy if exists "team_logos_write_operator" on storage.objects;
create policy "team_logos_write_operator" on storage.objects for all
  using (bucket_id = 'team-logos' and public.is_operator())
  with check (bucket_id = 'team-logos' and public.is_operator());

-- ============================================================================
-- REALTIME — make sure the tables /operator and /display need are broadcast
-- ============================================================================
alter publication supabase_realtime add table public.auctions;
alter publication supabase_realtime add table public.auction_players;
alter publication supabase_realtime add table public.bids;
alter publication supabase_realtime add table public.team_squads;
alter publication supabase_realtime add table public.purchases;
alter publication supabase_realtime add table public.auction_events;

-- ============================================================================
-- SEED: the 10 IPL teams (purses editable later in /teams)
-- ============================================================================
insert into public.teams (code, name, purse_total, purse_remaining)
values
  ('MI',   'Mumbai Indians',        10000, 10000),
  ('CSK',  'Chennai Super Kings',   10000, 10000),
  ('RCB',  'Royal Challengers Bengaluru', 10000, 10000),
  ('KKR',  'Kolkata Knight Riders', 10000, 10000),
  ('SRH',  'Sunrisers Hyderabad',   10000, 10000),
  ('RR',   'Rajasthan Royals',      10000, 10000),
  ('DC',   'Delhi Capitals',        10000, 10000),
  ('PBKS', 'Punjab Kings',          10000, 10000),
  ('GT',   'Gujarat Titans',        10000, 10000),
  ('LSG',  'Lucknow Super Giants',  10000, 10000)
on conflict (code) do nothing;

-- If you already have teams in Supabase and just want to reset every purse to
-- ₹100 Cr (10000 in the ₹Lakh unit used throughout the app), run:
-- update public.teams set purse_total = 10000, purse_remaining = 10000;

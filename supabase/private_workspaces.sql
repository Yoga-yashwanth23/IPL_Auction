-- ============================================================================
-- PRIVATE WORKSPACES — every visitor/device gets its own closed copy of the app.
-- Nothing a visitor changes (players, teams, auctions, bids, results, photos) is
-- visible to, or changes anything for, any other visitor.
--
-- BEFORE running: Supabase Dashboard → Authentication → Sign In / Providers →
--   turn ON "Allow anonymous sign-ins".
-- Run once in Supabase → SQL Editor. Safe to re-run.
-- ============================================================================

-- 0. (from the two-venue update — harmless if already present)
alter table public.auctions add column if not exists venue text;

-- 1. Every data table gets an owner (filled automatically with the signed-in visitor).
do $$
declare t text;
begin
  foreach t in array array['teams','players','auctions','auction_players','bids','purchases','team_squads','auction_events'] loop
    execute format('alter table public.%I add column if not exists owner_id uuid default auth.uid() references auth.users (id) on delete cascade', t);
    execute format('create index if not exists idx_%s_owner on public.%I (owner_id)', t, t);
  end loop;
end $$;

-- 2. Uniqueness is now per visitor (two visitors can both have team "MI" / player "123").
alter table public.teams   drop constraint if exists teams_code_key;
alter table public.players drop constraint if exists players_external_player_id_key;
drop index if exists public.idx_auctions_venue;
create unique index if not exists uq_teams_owner_code     on public.teams (owner_id, code);
create unique index if not exists uq_players_owner_extid  on public.players (owner_id, external_player_id);
create unique index if not exists uq_auctions_owner_venue on public.auctions (owner_id, venue) where venue is not null;

-- 3. One row per visitor so their starter data is created exactly once.
create table if not exists public.workspaces (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;

-- 4. Row-level security: a visitor can only see and change their OWN rows.
--    (Replaces every earlier policy, including any "RLS disabled" shortcut.)
do $$
declare r record; t text;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('teams','players','auctions','auction_players','bids','purchases','team_squads','auction_events','workspaces') loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;

  foreach t in array array['teams','players','auctions','auction_players','bids','purchases','team_squads','auction_events','workspaces'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- Rows that existed before this script have no owner. They are invisible to every
-- visitor and are used only as the STARTER data copied into each new workspace.

-- 5. Photos: public to view, but a visitor can only upload/replace inside their own folder.
do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and (policyname like 'player_images%' or policyname like 'team_logos%' or policyname like 'own_folder%') loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy player_images_read on storage.objects for select
  using (bucket_id in ('player-images', 'team-logos'));
create policy own_folder_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('player-images', 'team-logos') and (storage.foldername(name))[1] = auth.uid()::text);
create policy own_folder_update on storage.objects for update to authenticated
  using (bucket_id in ('player-images', 'team-logos') and (storage.foldername(name))[1] = auth.uid()::text);
create policy own_folder_delete on storage.objects for delete to authenticated
  using (bucket_id in ('player-images', 'team-logos') and (storage.foldername(name))[1] = auth.uid()::text);

-- 6. Called by the app on first visit: copies the starter teams + players into the
--    visitor's own workspace and creates their auction. Runs once per visitor.
create or replace function public.ensure_workspace()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  is_new boolean := false;
  n_players int := 0;
  n_teams int := 0;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  insert into workspaces (owner_id) values (uid) on conflict (owner_id) do nothing;
  get diagnostics n_teams = row_count;
  is_new := n_teams > 0;

  if is_new then
    -- teams (copied from the starter teams, or the 10 IPL defaults if there are none)
    insert into teams (owner_id, code, name, logo_url, primary_color, purse_total, purse_remaining,
                       squad_size_limit, squad_size_min, overseas_limit)
    select uid, code, name, logo_url, primary_color, purse_total, purse_total,
           squad_size_limit, squad_size_min, overseas_limit
    from teams where owner_id is null;
    get diagnostics n_teams = row_count;

    if n_teams = 0 then
      insert into teams (owner_id, code, name, purse_total, purse_remaining) values
        (uid, 'MI',   'Mumbai Indians',               10000, 10000),
        (uid, 'CSK',  'Chennai Super Kings',          10000, 10000),
        (uid, 'RCB',  'Royal Challengers Bengaluru',  10000, 10000),
        (uid, 'KKR',  'Kolkata Knight Riders',        10000, 10000),
        (uid, 'SRH',  'Sunrisers Hyderabad',          10000, 10000),
        (uid, 'RR',   'Rajasthan Royals',             10000, 10000),
        (uid, 'DC',   'Delhi Capitals',               10000, 10000),
        (uid, 'PBKS', 'Punjab Kings',                 10000, 10000),
        (uid, 'GT',   'Gujarat Titans',               10000, 10000),
        (uid, 'LSG',  'Lucknow Super Giants',         10000, 10000);
    end if;

    -- players (starter dataset, photos included — images are shared read-only)
    insert into players (owner_id, external_player_id, name, country, country_code, role, category,
                         base_price, age, batting_style, bowling_style, stats, discipline, capped_status,
                         is_marquee, set_code, set_order, image_filename, image_url, image_status,
                         is_duplicate, import_batch_id)
    select uid, external_player_id, name, country, country_code, role, category,
           base_price, age, batting_style, bowling_style, stats, discipline, capped_status,
           is_marquee, set_code, set_order, image_filename, image_url, image_status,
           false, import_batch_id
    from players
    where owner_id is null and not is_duplicate;
    get diagnostics n_players = row_count;

    insert into auctions (owner_id, name, venue) values (uid, 'IPL Mock Auction', 'venue-1');
  end if;

  return jsonb_build_object('new_workspace', is_new, 'players', n_players);
end;
$$;

revoke all on function public.ensure_workspace() from public;
grant execute on function public.ensure_workspace() to authenticated;

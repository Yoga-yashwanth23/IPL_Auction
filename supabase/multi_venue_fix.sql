-- ============================================================================
-- MULTI-VENUE — two (or more) venues, each running its OWN independent auction.
-- Run once in Supabase → SQL Editor, BEFORE deploying the new app version.
-- Safe to re-run.
-- ============================================================================

-- 1. Each auction belongs to a venue (the key used in ?venue=... links).
alter table public.auctions add column if not exists venue text;
create unique index if not exists idx_auctions_venue on public.auctions (venue) where venue is not null;

-- 2. Your existing auction becomes Venue 1 (name is editable in Auction Setup).
update public.auctions
set venue = 'venue-1'
where venue is null
  and id = (select id from public.auctions order by created_at limit 1);

-- 3. Create the second venue's auction (its queue is built from Auction Setup).
insert into public.auctions (name, venue)
select 'Venue 2 Auction', 'venue-2'
where not exists (select 1 from public.auctions where venue = 'venue-2');

-- 4. Purses are now worked out per auction from each venue's own squads, so the shared
--    teams table is no longer decremented. Nothing to migrate: any purse already spent
--    at Venue 1 is counted from its team_squads rows automatically.

-- 5. Put back players stuck as "live" (left behind when two screens drew at once).
update public.auction_players ap
set status = 'pending'
where ap.status = 'live'
  and ap.id is distinct from (
    select a.current_auction_player_id from public.auctions a where a.id = ap.auction_id
  );

-- 6. REVIEW players marked unsold so far at each venue.
select a.venue, p.name, p.set_code, ap.order_index
from public.auction_players ap
join public.auctions a on a.id = ap.auction_id
join public.players p on p.id = ap.player_id
where ap.status = 'unsold'
order by a.venue, p.set_order, ap.order_index;

-- 7. OPTIONAL: bring back every unsold player of ONE set at ONE venue
--    (change 'BA' and 'venue-1'). They are drawn again when that set comes up.
-- update public.auction_players ap
-- set status = 'pending', re_auction_count = 0
-- from public.players p, public.auctions a
-- where p.id = ap.player_id and a.id = ap.auction_id
--   and ap.status = 'unsold' and p.set_code = 'BA' and a.venue = 'venue-1';

# BidVoyage — Ocean Adventure IPL Mock Auction (Stage 1)

Stage 1 of the build: project scaffold, full Supabase schema, and the **Import Players**
flow (CSV/Excel/JSON parsing → image matching → validation review → save to database).

## 1. Set up the database

1. Open your Supabase project → **SQL Editor** → New query.
2. Paste the contents of `supabase/schema.sql` and run it.
   - Creates all 9 tables (`users`, `teams`, `players`, `auctions`, `auction_players`,
     `bids`, `purchases`, `team_squads`, `auction_events`), indexes, RLS policies,
     the `player-images` / `team-logos` storage buckets, and seeds the 10 IPL teams.
   - Safe to re-run.
3. **For Stage 1 testing**, RLS write policies require a row in `public.users` with
   role `admin`/`operator`. Easiest path right now: temporarily run
   `alter table public.players disable row level security;` (and re-enable once you've
   wired up real auth in a later stage), OR sign in a Supabase Auth user and insert
   a matching row into `public.users` with `role = 'operator'`. We'll wire proper
   auth + an operator login screen into a later stage.

## 2. Run the app locally

This environment can't reach npm's registry to install packages or run a build for
you, so run these on your own machine (Node 18+):

```bash
cd ipl-ocean-auction
npm install
npm run dev
```

`.env` is already filled in with the project URL + anon key you gave me. The anon
key is safe to keep in the repo (it's the public client key, not the service role
key) — just don't ever commit the service role key anywhere.

Open http://localhost:5173 — you'll land on the Dashboard. Try **Import Players**:
drop in a CSV/XLSX/JSON of players, then upload the matching folder of player
photos — the app matches each image to its player by filename, flags
missing/needs-review, and saves everything to Supabase.

## Dataset format

Required columns: `player_id, name, country, role, base_price`
Optional: `country_code, category, age, batting_style, bowling_style, state, image_filename, image_url, stats, is_marquee`

## Player photos — manual upload, matched by filename

Prepare a folder of player photos and upload it alongside the dataset on
**Import Players**. Each dataset record is matched to an image using, in order:

1. An exact match between `player_id` and the normalized image filename.
2. The record's declared `image_filename` column, normalized.
3. The player's `name`, normalized, as a last-resort fallback.

- **Priority order** per player: a dataset-supplied `image_url` → the matched
  uploaded photo → no photo (flagged **Missing**, never blocks the import).
- **A filename that matches more than one uploaded image** is flagged **Needs
  review** rather than guessed — a player must never end up wearing another
  player's photo.
- **Per-row override in the review screen.** Hover any player's photo in the
  review table and click the pencil icon to replace it with a different file —
  useful when the matched photo is wrong or a player has no match at all.

## Mega Auction set sequencing

Every imported player is placed into exactly one of 12 sets, in a fixed running order
(defined once, in `src/features/auction/auctionSets.ts`, and read by both the importer
and the Players list — never re-derived elsewhere):

1. **M1** — Marquee Set 1 (Indian marquee players)
2. **M2** — Marquee Set 2 (overseas marquee players)
3. **BA** — Capped Batters
4. **AR** — Capped All-Rounders
5. **WK** — Capped Wicketkeepers
6. **FA** — Capped Fast Bowlers
7. **SP** — Capped Spin Bowlers
8. **UBA** — Uncapped Batters
9. **UAR** — Uncapped All-Rounders
10. **UWK** — Uncapped Wicketkeepers
11. **UFA** — Uncapped Fast Bowlers
12. **USP** — Uncapped Spin Bowlers

How each player lands in a set:
- **Discipline** (BA/AR/WK/FA/SP) comes from `role`, with `bowler` split into FA vs. SP by
  whether `bowling_style` contains "spin".
- **Capped vs. Uncapped** comes from the dataset's `category` column (a blank category is
  treated as Capped).
- **Marquee (M1/M2)** is never inferred from stats or base price — it's an auction-committee
  call. Set it explicitly per player with an `is_marquee` column (`TRUE`/`FALSE`) in your
  dataset; India → M1, everyone else → M2.

This assignment happens automatically at import time (`commitImport.ts` calls
`assignAuctionSet()` per row) and is stored on the player row as `discipline`,
`capped_status`, `is_marquee`, `set_code`, `set_order`. The **Import → review table** shows
the computed set for every row before you commit, and the **Players** page can filter by
set and defaults to sorting in full auction running order (set → base price desc → name).

## What's built so far (Stage 1)

- Full DB schema + RLS + Realtime publication + storage buckets (`supabase/schema.sql`)
- Ocean Adventure design tokens (Tailwind config + `index.css`)
- App shell + navigation for all 10 planned pages
- Dashboard with live counts
- **Players → Import**: CSV/Excel/JSON parsing, image matching engine, duplicate
  detection, review table, batched upload + upsert (handles large datasets via
  chunked upserts + a bounded-concurrency image upload pool)
- **Players** list: paginated, searchable, filterable by role and by Mega Auction set,
  sorted in auction running order by default — built to stay fast at 10,000+ rows
- **Mega Auction set sequencing**: every player is auto-classified into one of the 12
  sets (M1/M2 → capped BA/AR/WK/FA/SP → uncapped UBA/UAR/UWK/UFA/USP) at import time,
  visible in both the import review table and the Players list (see above)

## Roadmap (next stages)

- **Stage 2** — Teams (purse/squad/overseas tracking) + Auction Setup (player ordering, increments)
- **Stage 3** — `/operator`: bidding engine, keyboard shortcuts, undo, timer, purse validation
- **Stage 4** — `/display`: presentation mode, Supabase Realtime sync, sold animations
- **Stage 5** — History, Analytics, Settings, and a full pass of the Ocean Adventure visual theme

Let me know when you've run the schema and tried the import — then we'll move to Stage 2.

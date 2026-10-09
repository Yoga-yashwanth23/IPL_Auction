import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import type { AuctionRow } from "@/types";

/**
 * Each venue runs its OWN auction (its own queue, bids, results and purses).
 * A venue is identified by the `venue` column on the auctions table and chosen with
 * `?venue=<key>` in the URL, e.g.  /operator?venue=venue-1   and   /operator?venue=venue-2
 * Without a URL key the last venue used on this device is used, then the oldest auction.
 */
const STORAGE_KEY = "ipl_venue";

export function getStoredVenue(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeVenue(venue: string) {
  try {
    localStorage.setItem(STORAGE_KEY, venue);
  } catch {
    /* storage can be blocked — the URL key still works */
  }
}

export function useVenueKey(): string | null {
  const [params] = useSearchParams();
  const fromUrl = params.get("venue");
  useEffect(() => {
    if (fromUrl) storeVenue(fromUrl);
  }, [fromUrl]);
  return fromUrl ?? getStoredVenue();
}

export function fetchVenueAuction(venue: string | null) {
  let q = supabase.from("auctions").select("*");
  if (venue) q = q.eq("venue", venue);
  return q.order("created_at", { ascending: true }).limit(1).maybeSingle();
}

export async function listVenues(): Promise<AuctionRow[]> {
  const { data } = await supabase
    .from("auctions")
    .select("*")
    .not("venue", "is", null)
    .order("created_at", { ascending: true });
  return (data ?? []) as AuctionRow[];
}

export async function createVenue(): Promise<AuctionRow | null> {
  const existing = await listVenues();
  const used = new Set(existing.map((v) => v.venue));
  let n = existing.length + 1;
  while (used.has(`venue-${n}`)) n += 1;
  const { data } = await supabase
    .from("auctions")
    .insert({ name: `Venue ${n} Auction`, venue: `venue-${n}` })
    .select("*")
    .single();
  return (data as AuctionRow) ?? null;
}

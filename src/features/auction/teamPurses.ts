import { supabase } from "@/lib/supabase";
import type { TeamRow } from "@/types";

/**
 * Purse is worked out PER AUCTION: purse_total minus everything that team has bought in
 * that auction (team_squads). Nothing is decremented on the shared teams table, so two
 * venues can never touch each other's purses, and a purse can never drift out of sync.
 */
export async function loadTeamsWithPurse(auctionId: string): Promise<TeamRow[]> {
  const [{ data: teams }, { data: squads }] = await Promise.all([
    supabase.from("teams").select("*").order("name", { ascending: true }),
    supabase.from("team_squads").select("team_id, price").eq("auction_id", auctionId),
  ]);
  const spent = new Map<string, number>();
  (squads ?? []).forEach((s) => spent.set(s.team_id, (spent.get(s.team_id) ?? 0) + Number(s.price)));
  return (teams ?? []).map((t) => ({ ...t, purse_remaining: t.purse_total - (spent.get(t.id) ?? 0) }));
}

import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertTriangle, RotateCcw, Gavel, Shield, Radio } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AuctionRow } from "@/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export default function SettingsPage() {
  const [auction, setAuction] = useState<AuctionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("auctions")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    setAuction(data ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetAuction = async () => {
    if (!auction) return;
    setResetting(true);
    setError(null);

    // Put every queued player back to pending.
    const { error: apError } = await supabase
      .from("auction_players")
      .update({ status: "pending", final_price: null, sold_to_team_id: null, re_auction_count: 0 })
      .eq("auction_id", auction.id);
    if (apError) {
      setError(apError.message);
      setResetting(false);
      return;
    }

    // Wipe every record of what happened in the previous run.
    await Promise.all([
      supabase.from("purchases").delete().eq("auction_id", auction.id),
      supabase.from("team_squads").delete().eq("auction_id", auction.id),
      supabase.from("bids").delete().eq("auction_id", auction.id),
      supabase.from("auction_events").delete().eq("auction_id", auction.id),
    ]);

    // Refund every team back to its starting purse.
    const { data: allTeams } = await supabase.from("teams").select("id, purse_total");
    if (allTeams) {
      await Promise.all(
        allTeams.map((t) => supabase.from("teams").update({ purse_remaining: t.purse_total }).eq("id", t.id))
      );
    }

    // Reset the auction pointer so the next load picks the very first player.
    const { data: updated, error: resetError } = await supabase
      .from("auctions")
      .update({
        status: "ready",
        current_auction_player_id: null,
        current_bid: 0,
        highest_bidder_team_id: null,
        timer_remaining: auction.timer_seconds,
        timer_status: "stopped",
      })
      .eq("id", auction.id)
      .select("*")
      .single();

    setResetting(false);
    setConfirmOpen(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }
    setAuction(updated);
    setDone(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-parchment/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-lagoon/70">Settings</p>
        <h1 className="mt-1 font-display text-2xl text-parchment sm:text-3xl">Ship's manifest</h1>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-coral">{error}</div>
      )}
      {done && (
        <div className="mb-4 rounded-md border border-lagoon/40 bg-lagoon/10 px-4 py-3 text-sm text-lagoon-bright">
          Auction reset — every team's purse is refunded and the queue starts fresh from the first player.
        </div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Auction overview</CardTitle>
          <CardDescription>Quick links to the other setup screens.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {auction ? (
            <div className="flex items-center justify-between rounded-md bg-deep/40 px-4 py-3">
              <div>
                <p className="text-sm text-parchment">{auction.name}</p>
                <p className="text-xs text-parchment/50">Bid timer {auction.timer_seconds}s · Increment auto (bracketed by bid value)</p>
              </div>
              <Badge variant={auction.status === "live" ? "matched" : "neutral"} className="capitalize">
                {auction.status}
              </Badge>
            </div>
          ) : (
            <p className="text-sm text-parchment/50">No auction configured yet.</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href="/auction">
                <Radio className="h-4 w-4" /> Auction Setup
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/teams">
                <Shield className="h-4 w-4" /> Teams
              </a>
            </Button>
            <Button variant="brass" asChild>
              <a href="/operator">
                <Gavel className="h-4 w-4" /> Live Auction
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-coral/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-coral">
            <AlertTriangle className="h-4 w-4" /> Danger zone
          </CardTitle>
          <CardDescription>Destructive actions — there's no undo once confirmed.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-md border border-coral/20 bg-coral/5 px-4 py-3">
            <div>
              <p className="text-sm text-parchment">Reset auction results</p>
              <p className="text-xs text-parchment/50">
                Clears every sold/unsold result, refunds every team's purse, and restarts the queue from the first player. Players and teams themselves are kept.
              </p>
            </div>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={!auction}>
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-coral">
              <AlertTriangle className="h-4 w-4" /> Reset the auction?
            </DialogTitle>
            <DialogDescription>
              This permanently clears every sold/unsold result, refunds every team's purse, and restarts from the first
              player. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={resetting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={resetAuction} disabled={resetting}>
              {resetting && <Loader2 className="h-4 w-4 animate-spin" />} Yes, reset everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

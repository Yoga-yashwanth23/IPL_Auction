import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ListOrdered, Radio, Save, RefreshCw, Trash2, PlayCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AuctionRow, AuctionPlayerRow, PlayerRow } from "@/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn, formatCr } from "@/lib/utils";
import { AUCTION_SET_SEQUENCE, sortByAuctionOrder } from "@/features/auction/auctionSets";
import { fetchVenueAuction, useVenueKey } from "@/lib/venue";

type QueueRow = AuctionPlayerRow & { player: Pick<PlayerRow, "name" | "set_code" | "base_price" | "country"> };

const DEFAULT_NAME = "IPL Mock Auction";

export default function AuctionSetupPage() {
  const venue = useVenueKey();
  const [auction, setAuction] = useState<AuctionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(DEFAULT_NAME);
  const [timerSeconds, setTimerSeconds] = useState("30");

  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [playerTotal, setPlayerTotal] = useState(0);
  const [queueLoading, setQueueLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [hasProgress, setHasProgress] = useState(false); // true if any auction_player is sold/unsold/live

  const loadAuction = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchVenueAuction(venue);

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    let row: AuctionRow;
    if (data) {
      row = data;
    } else {
      const { data: created, error: createError } = await supabase
        .from("auctions")
        .insert({ name: DEFAULT_NAME, venue: venue ?? "venue-1" })
        .select("*")
        .single();
      if (createError || !created) {
        setError(createError?.message ?? "Could not create the auction.");
        setLoading(false);
        return;
      }
      row = created;
    }

    setAuction(row);
    setName(row.name);
    setTimerSeconds(String(row.timer_seconds));
    setLoading(false);
  }, [venue]);

  const loadQueue = useCallback(async (auctionId: string) => {
    setQueueLoading(true);
    const { count: total } = await supabase.from("players").select("*", { count: "exact", head: true });
    setPlayerTotal(total ?? 0);

    const { data, count, error } = await supabase
      .from("auction_players")
      .select("*, player:players(name, set_code, base_price, country)", { count: "exact" })
      .eq("auction_id", auctionId)
      .order("order_index", { ascending: true })
      .limit(50);

    if (!error) {
      setQueue((data ?? []) as unknown as QueueRow[]);
      setQueueTotal(count ?? 0);
    }

    const { count: progressCount } = await supabase
      .from("auction_players")
      .select("*", { count: "exact", head: true })
      .eq("auction_id", auctionId)
      .neq("status", "pending");
    setHasProgress((progressCount ?? 0) > 0);

    setQueueLoading(false);
  }, []);

  useEffect(() => {
    loadAuction();
  }, [loadAuction]);

  useEffect(() => {
    if (auction) loadQueue(auction.id);
  }, [auction?.id, loadQueue]);

  const setsSummary = useMemo(() => {
    const bySet = new Map<string, number>();
    queue.forEach((q) => {
      const code = q.player?.set_code ?? "—";
      bySet.set(code, (bySet.get(code) ?? 0) + 1);
    });
    return bySet;
  }, [queue]);

  const handleSaveConfig = async () => {
    if (!auction) return;
    setSaving(true);
    setError(null);

    const seconds = Number(timerSeconds);

    if (Number.isNaN(seconds)) {
      setError("Check timer seconds — it must be a valid number.");
      setSaving(false);
      return;
    }

    const { data, error } = await supabase
      .from("auctions")
      .update({
        name: name.trim() || DEFAULT_NAME,
        timer_seconds: seconds,
        timer_remaining: auction.timer_status === "stopped" ? seconds : auction.timer_remaining,
      })
      .eq("id", auction.id)
      .select("*")
      .single();

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setAuction(data);
  };

  const buildQueue = async (rebuild: boolean) => {
    if (!auction) return;
    setBuilding(true);
    setError(null);

    if (rebuild) {
      const { error: deleteError } = await supabase
        .from("auction_players")
        .delete()
        .eq("auction_id", auction.id)
        .eq("status", "pending");
      if (deleteError) {
        setError(deleteError.message);
        setBuilding(false);
        return;
      }
    }

    // Players already queued (any status) should not be re-inserted.
    const { data: existing } = await supabase
      .from("auction_players")
      .select("player_id")
      .eq("auction_id", auction.id);
    const existingIds = new Set((existing ?? []).map((r) => r.player_id));

    const { data: allPlayers, error: playersError } = await supabase
      .from("players")
      .select("id, name, base_price, set_order")
      .order("set_order", { ascending: true, nullsFirst: false });

    if (playersError) {
      setError(playersError.message);
      setBuilding(false);
      return;
    }

    const sorted = sortByAuctionOrder(
      (allPlayers ?? []).map((p) => ({ id: p.id, name: p.name, base_price: p.base_price, set_order: p.set_order }))
    );

    const { count: currentMax } = await supabase
      .from("auction_players")
      .select("*", { count: "exact", head: true })
      .eq("auction_id", auction.id);

    const toInsert = sorted
      .filter((p) => !existingIds.has(p.id))
      .map((p, i) => ({
        auction_id: auction.id,
        player_id: p.id,
        order_index: (currentMax ?? 0) + i + 1,
        status: "pending" as const,
      }));

    if (toInsert.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const { error: insertError } = await supabase.from("auction_players").insert(toInsert.slice(i, i + BATCH));
        if (insertError) {
          setError(insertError.message);
          setBuilding(false);
          return;
        }
      }
    }

    setBuilding(false);
    loadQueue(auction.id);
  };

  const markLive = async () => {
    if (!auction) return;
    const { data, error } = await supabase
      .from("auctions")
      .update({ status: "live" })
      .eq("id", auction.id)
      .select("*")
      .single();
    if (!error) setAuction(data);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-parchment/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading auction setup…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-lagoon/70">Auction Setup</p>
          <h1 className="mt-1 font-display text-2xl text-parchment sm:text-3xl">Chart the course</h1>
          <p className="mt-1 text-sm text-parchment/60">
            Configure the run, then build the bidding queue in fixed Mega Auction order.
          </p>
        </div>
        <Badge variant={auction?.status === "live" ? "matched" : "neutral"} className="w-fit self-start capitalize">
          {auction?.status}
        </Badge>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-coral">{error}</div>
      )}

      {auction?.venue && (
        <div className="mb-6 rounded-md border border-lagoon/30 bg-deep/50 px-4 py-3 text-sm text-parchment/80">
          <p className="mb-1 font-medium text-parchment">Links for this venue ({auction.name})</p>
          <p className="break-all text-xs text-parchment/60">
            Operator: <code>{window.location.origin}/operator?venue={auction.venue}</code>
          </p>
          <p className="break-all text-xs text-parchment/60">
            Presentation screen: <code>{window.location.origin}/display?venue={auction.venue}</code>
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {/* Auction config */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-lagoon-bright" /> Auction config
            </CardTitle>
            <CardDescription>Name, clock, and the automatic bid increment schedule.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <Label htmlFor="auction-name">Auction name</Label>
              <Input id="auction-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="timer-seconds">Bid timer (seconds)</Label>
              <Input
                id="timer-seconds"
                inputMode="numeric"
                value={timerSeconds}
                onChange={(e) => setTimerSeconds(e.target.value)}
              />
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-parchment/50">
                Bid increment schedule (automatic)
              </p>
              <div className="overflow-hidden rounded-md border border-wood-light/15 text-sm">
                <table className="w-full text-left">
                  <thead className="bg-deep/60 text-parchment/60">
                    <tr>
                      <th className="px-3 py-2 font-medium">Current bid</th>
                      <th className="px-3 py-2 font-medium">Increment</th>
                    </tr>
                  </thead>
                  <tbody className="text-parchment/80">
                    {[
                      ["Up to ₹1 Cr", "₹5 L"],
                      ["₹1 Cr – ₹2 Cr", "₹10 L"],
                      ["₹2 Cr – ₹5 Cr", "₹25 L"],
                      ["₹5 Cr – ₹10 Cr", "₹50 L"],
                      ["₹10 Cr – ₹20 Cr", "₹1 Cr"],
                      ["Above ₹20 Cr", "₹2 Cr"],
                    ].map(([bracket, inc]) => (
                      <tr key={bracket} className="border-t border-wood-light/10">
                        <td className="px-3 py-1.5">{bracket}</td>
                        <td className="px-3 py-1.5">{inc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-xs text-parchment/40">
                Increments step up automatically as the bid crosses each bracket — no manual setting needed.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={handleSaveConfig} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save config
              </Button>
              <Button
                variant="brass"
                onClick={markLive}
                disabled={auction?.status === "live" || queueTotal === 0}
                title={queueTotal === 0 ? "Build the queue first" : undefined}
              >
                <PlayCircle className="h-4 w-4" /> Mark auction live
              </Button>
            </div>
            {auction?.status === "live" && (
              <p className="text-xs text-parchment/50">
                This auction is marked live. Bidding controls arrive with the operator console (Stage 3) — head to{" "}
                <a href={`/operator?venue=${auction.venue ?? ""}`} className="text-lagoon underline underline-offset-4">
                  Live Auction
                </a>{" "}
                once it ships.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Player queue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-lagoon-bright" /> Player queue
            </CardTitle>
            <CardDescription>
              {queueTotal.toLocaleString()} of {playerTotal.toLocaleString()} players queued, in fixed set order.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => buildQueue(false)} disabled={building}>
                {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListOrdered className="h-4 w-4" />}
                {queueTotal === 0 ? "Build queue" : "Add new players to queue"}
              </Button>
              {queueTotal > 0 && (
                <Button
                  variant="outline"
                  onClick={() => buildQueue(true)}
                  disabled={building || hasProgress}
                  title={hasProgress ? "Bidding has already started — rebuild is disabled" : undefined}
                >
                  <RefreshCw className="h-4 w-4" /> Rebuild queue order
                </Button>
              )}
            </div>
            {hasProgress && (
              <p className="flex items-center gap-1.5 text-xs text-brass-bright">
                <Trash2 className="h-3.5 w-3.5" /> Some players already have a bidding outcome — the queue order is
                locked to protect results.
              </p>
            )}

            {AUCTION_SET_SEQUENCE.length > 0 && queueTotal > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {AUCTION_SET_SEQUENCE.map((s) => (
                  <Badge key={s.code} variant="neutral" title={s.label}>
                    {s.code}: {setsSummary.get(s.code) ?? 0}
                  </Badge>
                ))}
              </div>
            )}

            {queueLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-parchment/50">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading queue…
              </div>
            ) : queue.length === 0 ? (
              <div className="rounded-md border border-wood-light/15 bg-deep/40 py-10 text-center text-sm text-parchment/50">
                No players queued yet — build the queue to pull in every imported player, ordered M1 → USP.
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto rounded-md border border-wood-light/15">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-deep text-parchment/60">
                    <tr>
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Player</th>
                      <th className="px-3 py-2 font-medium">Set</th>
                      <th className="px-3 py-2 font-medium">Base price</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((q) => (
                      <tr key={q.id} className="border-t border-wood-light/10 hover:bg-cove/40">
                        <td className="px-3 py-2 text-parchment/60">{q.order_index}</td>
                        <td className="px-3 py-2 text-parchment">{q.player?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-parchment/70">{q.player?.set_code ?? "—"}</td>
                        <td className="px-3 py-2 text-parchment/70">{formatCr(q.player?.base_price ?? 0)}</td>
                        <td className="px-3 py-2">
                          <Badge
                            variant={
                              q.status === "sold" ? "matched" : q.status === "unsold" ? "missing" : "neutral"
                            }
                            className="capitalize"
                          >
                            {q.status.replace("_", " ")}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {queueTotal > queue.length && (
                  <p className={cn("px-3 py-2 text-xs text-parchment/40")}>
                    Showing first {queue.length} of {queueTotal.toLocaleString()} queued players.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

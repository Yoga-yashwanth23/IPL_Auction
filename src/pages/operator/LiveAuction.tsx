import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Anchor,
  Loader2,
  Gavel,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  ArrowRight,
  PartyPopper,
  Menu,
  ListChecks,
  X,
  Square,
  PlayCircle,
  RotateCcw,
  Users,
  Undo2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AuctionRow, AuctionPlayerRow, AuctionPlayerStatus, TeamRow, PlayerRow } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn, formatCr, getBidIncrement } from "@/lib/utils";
import { AUCTION_SET_SEQUENCE, getSetDef } from "@/features/auction/auctionSets";

type CurrentAuctionPlayer = AuctionPlayerRow & { player: PlayerRow };

interface SquadStat {
  count: number;
  overseasCount: number;
}

interface QueueItem {
  id: string;
  status: AuctionPlayerStatus;
  order_index: number;
  final_price: number | null;
  sold_to_team_id: string | null;
  player: { id: string; name: string; set_code: string | null } | null;
}

interface SetTransition {
  fromCode: string;
  fromLabel: string;
  toCode: string;
  toLabel: string;
}

interface SoldInfo {
  playerName: string;
  playerImage: string | null;
  teamName: string;
  teamCode: string;
  price: number;
}

interface RosterPlayer {
  player_id: string;
  name: string;
  price: number;
  is_overseas: boolean;
  role: string | null;
}

const AUTO_ADVANCE_MS = 4500;

/** This page only: a tropical-cove backdrop behind the bidding UI, dimmed enough
 *  that cards, text, and the team rail stay readable on top of it. */
const PAGE_BACKGROUND_STYLE: CSSProperties = {
  backgroundImage:
    "linear-gradient(rgba(6, 24, 38, 0.8), rgba(6, 24, 38, 0.85)), url('/images/auction-background.webp')",
  backgroundSize: "cover",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  backgroundAttachment: "fixed",
};

function isOverseas(country: string | null | undefined): boolean {
  return (country ?? "").trim().toLowerCase() !== "india";
}

export default function LiveAuctionPage() {
  const [auction, setAuction] = useState<AuctionRow | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [current, setCurrent] = useState<CurrentAuctionPlayer | null>(null);
  const [squadStats, setSquadStats] = useState<Record<string, SquadStat>>({});
  const [counts, setCounts] = useState({ pending: 0, sold: 0, unsold: 0, total: 0 });
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [noQueue, setNoQueue] = useState(false);
  const [soldInfo, setSoldInfo] = useState<SoldInfo | null>(null);
  const [autoAdvanceSeconds, setAutoAdvanceSeconds] = useState(0);
  const [showQueue, setShowQueue] = useState(false);
  const [showTeams, setShowTeams] = useState(false);
  const [showSquads, setShowSquads] = useState(false);
  const [squadTeamId, setSquadTeamId] = useState<string | null>(null);
  const [squadRoster, setSquadRoster] = useState<RosterPlayer[]>([]);
  const [squadRosterLoading, setSquadRosterLoading] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [ending, setEnding] = useState(false);
  const [resuming, setResuming] = useState<"resume" | "new" | null>(null);
  const [setTransition, setSetTransition] = useState<SetTransition | null>(null);
  const [queueFilter, setQueueFilter] = useState<string>("all");

  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousSetCodeRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (setTransitionTimerRef.current) clearTimeout(setTransitionTimerRef.current);
    },
    []
  );

  /** Fires the "set complete" popup the moment the next player picked belongs to a
   *  different (later) set than the one we were just working through. Silent on the
   *  very first player of a session, since there's no "previous" set to compare yet. */
  const maybeAnnounceSetChange = useCallback((newSetCode: string | null | undefined) => {
    const prev = previousSetCodeRef.current;
    if (prev && newSetCode && prev !== newSetCode) {
      const fromDef = getSetDef(prev);
      const toDef = getSetDef(newSetCode);
      setSetTransition({
        fromCode: prev,
        fromLabel: fromDef?.label ?? prev,
        toCode: newSetCode,
        toLabel: toDef?.label ?? newSetCode,
      });
      if (setTransitionTimerRef.current) clearTimeout(setTransitionTimerRef.current);
      setTransitionTimerRef.current = setTimeout(() => setSetTransition(null), 5000);
    }
    previousSetCodeRef.current = newSetCode ?? previousSetCodeRef.current;
  }, []);

  const clearAdvanceTimers = useCallback(() => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  useEffect(() => clearAdvanceTimers, [clearAdvanceTimers]);

  const loadSquadStats = useCallback(async (auctionId: string) => {
    const { data } = await supabase.from("team_squads").select("team_id, is_overseas").eq("auction_id", auctionId);
    const stats: Record<string, SquadStat> = {};
    (data ?? []).forEach((row) => {
      const s = stats[row.team_id] ?? { count: 0, overseasCount: 0 };
      s.count += 1;
      if (row.is_overseas) s.overseasCount += 1;
      stats[row.team_id] = s;
    });
    setSquadStats(stats);
  }, []);

  const openTeamSquad = useCallback(
    async (teamId: string) => {
      if (!auction) return;
      setSquadTeamId(teamId);
      setSquadRosterLoading(true);
      const { data } = await supabase
        .from("team_squads")
        .select("price, is_overseas, player:players(id, name, role)")
        .eq("auction_id", auction.id)
        .eq("team_id", teamId)
        .order("price", { ascending: false });
      setSquadRoster(
        ((data ?? []) as unknown as { price: number; is_overseas: boolean; player: { id: string; name: string; role: string | null } | null }[]).map(
          (row) => ({
            player_id: row.player?.id ?? "",
            name: row.player?.name ?? "—",
            price: row.price,
            is_overseas: row.is_overseas,
            role: row.player?.role ?? null,
          })
        )
      );
      setSquadRosterLoading(false);
    },
    [auction]
  );

  const closeSquadsPanel = useCallback(() => {
    setShowSquads(false);
    setSquadTeamId(null);
    setSquadRoster([]);
  }, []);

  const loadCounts = useCallback(async (auctionId: string) => {
    const [pending, sold, unsold, total] = await Promise.all([
      supabase.from("auction_players").select("*", { count: "exact", head: true }).eq("auction_id", auctionId).eq("status", "pending"),
      supabase.from("auction_players").select("*", { count: "exact", head: true }).eq("auction_id", auctionId).eq("status", "sold"),
      supabase.from("auction_players").select("*", { count: "exact", head: true }).eq("auction_id", auctionId).eq("status", "unsold"),
      supabase.from("auction_players").select("*", { count: "exact", head: true }).eq("auction_id", auctionId),
    ]);
    setCounts({
      pending: pending.count ?? 0,
      sold: sold.count ?? 0,
      unsold: unsold.count ?? 0,
      total: total.count ?? 0,
    });
  }, []);

  const loadQueue = useCallback(async (auctionId: string) => {
    const { data } = await supabase
      .from("auction_players")
      .select("id, status, order_index, final_price, sold_to_team_id, player:players(id, name, set_code)")
      .eq("auction_id", auctionId)
      .order("order_index", { ascending: true });
    setQueue((data ?? []) as unknown as QueueItem[]);
  }, []);

  const loadCurrent = useCallback(async (auctionRow: AuctionRow) => {
    setNoQueue(false);
    setComplete(false);

    if (auctionRow.current_auction_player_id) {
      const { data } = await supabase
        .from("auction_players")
        .select("*, player:players(*)")
        .eq("id", auctionRow.current_auction_player_id)
        .maybeSingle();
      // Only trust this pointer while the player is still actually up for auction.
      // Once it's been finalized as sold/unsold it's no longer "current" even if the
      // auctions row hasn't had its pointer cleared yet — fall through and pick the
      // next pending player instead of re-showing the one that was just decided.
      if (data && (data.status === "pending" || data.status === "live")) {
        maybeAnnounceSetChange((data as unknown as CurrentAuctionPlayer).player.set_code);
        setCurrent(data as unknown as CurrentAuctionPlayer);
        return;
      }
    }

    // No current pointer (or it's stale) — pick the next player at random from whichever
    // auction set is earliest in the fixed running order (M1 → M2 → BA → AR → ...) among
    // the players still pending. The set-to-set sequence stays fixed; within a set the
    // reveal order is randomized instead of following order_index.
    const { data: pendingRows } = await supabase
      .from("auction_players")
      .select("id, player:players(set_order)")
      .eq("auction_id", auctionRow.id)
      .eq("status", "pending");

    const pending = (pendingRows ?? []) as unknown as Array<{
      id: string;
      player: { set_order: number | null } | null;
    }>;

    if (pending.length === 0) {
      const { count: totalQueued } = await supabase
        .from("auction_players")
        .select("*", { count: "exact", head: true })
        .eq("auction_id", auctionRow.id);
      setCurrent(null);
      if ((totalQueued ?? 0) === 0) setNoQueue(true);
      else setComplete(true);
      return;
    }

    const minSetOrder = Math.min(...pending.map((r) => r.player?.set_order ?? 999));
    const candidateIds = pending.filter((r) => (r.player?.set_order ?? 999) === minSetOrder).map((r) => r.id);
    const nextId = candidateIds[Math.floor(Math.random() * candidateIds.length)];

    const { data: next } = await supabase
      .from("auction_players")
      .select("*, player:players(*)")
      .eq("id", nextId)
      .maybeSingle();

    if (!next) {
      setCurrent(null);
      setComplete(true);
      return;
    }

    await supabase
      .from("auction_players")
      .update({ status: "live" })
      .eq("id", next.id);
    await supabase
      .from("auctions")
      .update({ current_auction_player_id: next.id, current_bid: 0, highest_bidder_team_id: null, timer_remaining: auctionRow.timer_seconds })
      .eq("id", auctionRow.id);

    maybeAnnounceSetChange((next as unknown as CurrentAuctionPlayer).player.set_code);
    setCurrent({ ...(next as unknown as CurrentAuctionPlayer), status: "live" });
    setAuction({ ...auctionRow, current_auction_player_id: next.id, current_bid: 0, highest_bidder_team_id: null });
  }, [maybeAnnounceSetChange]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: auctionRow, error: auctionError } = await supabase
      .from("auctions")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (auctionError || !auctionRow) {
      setError(auctionError?.message ?? "No auction has been configured yet.");
      setLoading(false);
      return;
    }

    const { data: teamRows } = await supabase.from("teams").select("*").order("name", { ascending: true });

    setAuction(auctionRow);
    setTeams(teamRows ?? []);

    // The operator ended this auction earlier — don't auto-load/advance a "current"
    // player. Just surface the resume-or-restart choice, with counts for context.
    if (auctionRow.status === "ended") {
      await loadCounts(auctionRow.id);
      setCurrent(null);
      setLoading(false);
      return;
    }

    await Promise.all([
      loadCurrent(auctionRow),
      loadSquadStats(auctionRow.id),
      loadCounts(auctionRow.id),
      loadQueue(auctionRow.id),
    ]);
    setLoading(false);
  }, [loadCurrent, loadSquadStats, loadCounts, loadQueue]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Default the player-list drawer to whichever set is currently live, so opening it
  // shows "this marquee set's players" rather than all 650+ at once.
  useEffect(() => {
    if (showQueue) {
      setQueueFilter(current?.player.set_code ?? "all");
    }
  }, [showQueue]); // eslint-disable-line react-hooks/exhaustive-deps

  const placeBid = async (team: TeamRow) => {
    if (!auction || !current || busy) return;
    setBusy(true);
    setError(null);

    const increment = getBidIncrement(auction.current_bid > 0 ? auction.current_bid : current.player.base_price);
    const newBid = auction.current_bid > 0 ? auction.current_bid + increment : current.player.base_price;

    if (newBid > team.purse_remaining) {
      setError(`${team.name} doesn't have enough purse remaining for this bid.`);
      setBusy(false);
      return;
    }

    const { error: bidError } = await supabase.from("bids").insert({
      auction_id: auction.id,
      auction_player_id: current.id,
      team_id: team.id,
      amount: newBid,
      increment_used: increment,
    });
    if (bidError) {
      setError(bidError.message);
      setBusy(false);
      return;
    }

    const { data: updatedAuction, error: updateError } = await supabase
      .from("auctions")
      .update({ current_bid: newBid, highest_bidder_team_id: team.id })
      .eq("id", auction.id)
      .select("*")
      .single();

    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setAuction(updatedAuction);
  };

  /** Steps the current bid back by one: voids the most recent bid on this player and
   *  restores whichever bid came before it — amount and team both — so the card reverts
   *  to showing the previous bidder as the leader again. If that was the only bid, the
   *  slot clears back to "no bid yet". */
  const undoBid = async () => {
    if (!auction || !current || busy || !auction.highest_bidder_team_id) return;
    setBusy(true);
    setError(null);

    const { data: recentBids, error: bidsError } = await supabase
      .from("bids")
      .select("*")
      .eq("auction_player_id", current.id)
      .eq("is_undone", false)
      .order("created_at", { ascending: false })
      .limit(2);

    if (bidsError) {
      setError(bidsError.message);
      setBusy(false);
      return;
    }

    const [lastBid, previousBid] = recentBids ?? [];
    if (!lastBid) {
      setBusy(false);
      return;
    }

    const { error: undoError } = await supabase.from("bids").update({ is_undone: true }).eq("id", lastBid.id);
    if (undoError) {
      setError(undoError.message);
      setBusy(false);
      return;
    }

    const restoredBid = previousBid?.amount ?? 0;
    const restoredTeamId = previousBid?.team_id ?? null;

    const { data: updatedAuction, error: updateError } = await supabase
      .from("auctions")
      .update({ current_bid: restoredBid, highest_bidder_team_id: restoredTeamId })
      .eq("id", auction.id)
      .select("*")
      .single();

    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setAuction(updatedAuction);
  };

  const advance = useCallback(async () => {
    if (!auction) return;
    // Re-fetch the auction row fresh rather than trusting the local `auction` state —
    // it may still hold the pointer/bid for the player that was just sold/unsold.
    const [{ data: freshAuction }, { data: refreshedTeams }] = await Promise.all([
      supabase.from("auctions").select("*").eq("id", auction.id).maybeSingle(),
      supabase.from("teams").select("*").order("name", { ascending: true }),
    ]);
    const auctionRow = freshAuction ?? auction;
    setAuction(auctionRow);
    setTeams(refreshedTeams ?? []);
    await loadCurrent(auctionRow);
    await loadSquadStats(auctionRow.id);
    await loadCounts(auctionRow.id);
    await loadQueue(auctionRow.id);
    setBusy(false);
  }, [auction, loadCurrent, loadSquadStats, loadCounts, loadQueue]);

  const runAdvance = useCallback(async () => {
    clearAdvanceTimers();
    setSoldInfo(null);
    await advance();
  }, [advance, clearAdvanceTimers]);

  const revealSold = useCallback(
    (info: SoldInfo) => {
      clearAdvanceTimers();
      setSoldInfo(info);
      setAutoAdvanceSeconds(Math.round(AUTO_ADVANCE_MS / 1000));
      countdownIntervalRef.current = setInterval(() => {
        setAutoAdvanceSeconds((s) => (s > 0 ? s - 1 : 0));
      }, 1000);
      advanceTimerRef.current = setTimeout(() => {
        runAdvance();
      }, AUTO_ADVANCE_MS);
    },
    [clearAdvanceTimers, runAdvance]
  );

  const finalizeSold = async () => {
    if (!auction || !current || !auction.highest_bidder_team_id || busy) return;
    setBusy(true);
    setError(null);

    const price = auction.current_bid;
    const teamId = auction.highest_bidder_team_id;
    const overseas = isOverseas(current.player.country);
    const team = teams.find((t) => t.id === teamId) ?? null;

    const { error: purchaseError } = await supabase.from("purchases").insert({
      auction_id: auction.id,
      auction_player_id: current.id,
      player_id: current.player_id,
      team_id: teamId,
      price,
      is_overseas: overseas,
    });

    // A duplicate-key error here means this player was already recorded as sold
    // by an earlier click (e.g. a race from a double click) — don't re-write the
    // purchase/purse/squad rows again, just resync and show the reveal.
    const isDuplicate = purchaseError?.code === "23505";
    if (purchaseError && !isDuplicate) {
      setError(purchaseError.message);
      setBusy(false);
      return;
    }

    if (!isDuplicate) {
      await supabase.from("team_squads").insert({
        auction_id: auction.id,
        team_id: teamId,
        player_id: current.player_id,
        price,
        is_overseas: overseas,
      });

      if (team) {
        await supabase.from("teams").update({ purse_remaining: team.purse_remaining - price }).eq("id", team.id);
      }

      await supabase
        .from("auction_players")
        .update({ status: "sold", final_price: price, sold_to_team_id: teamId })
        .eq("id", current.id);

      await supabase.from("auction_events").insert({
        auction_id: auction.id,
        event_type: "sold",
        auction_player_id: current.id,
        team_id: teamId,
        payload: { price },
      });
    }

    // Clear the "current" pointer now that this player has been decided (whether this
    // click did the deciding, or it was already decided by an earlier duplicate click) —
    // otherwise the next advance keeps re-fetching this same finalized player forever.
    const { data: clearedAuction } = await supabase
      .from("auctions")
      .update({ current_auction_player_id: null, current_bid: 0, highest_bidder_team_id: null })
      .eq("id", auction.id)
      .select("*")
      .single();
    if (clearedAuction) setAuction(clearedAuction);

    revealSold({
      playerName: current.player.name,
      playerImage: current.player.image_url,
      teamName: team?.name ?? "—",
      teamCode: team?.code ?? "—",
      price,
    });
  };

  const finalizeUnsold = async () => {
    if (!auction || !current || busy) return;
    setBusy(true);
    setError(null);

    await supabase
      .from("auction_players")
      .update({ status: "unsold", re_auction_count: current.re_auction_count + 1 })
      .eq("id", current.id);

    await supabase.from("auction_events").insert({
      auction_id: auction.id,
      event_type: "unsold",
      auction_player_id: current.id,
    });

    // Clear the "current" pointer so advance() doesn't just re-fetch this same
    // now-unsold player again.
    await supabase
      .from("auctions")
      .update({ current_auction_player_id: null, current_bid: 0, highest_bidder_team_id: null })
      .eq("id", auction.id);

    await advance();
  };

  const endAuction = async () => {
    if (!auction || ending) return;
    setEnding(true);
    setError(null);

    clearAdvanceTimers();
    setSoldInfo(null);

    const { data: updated, error: endError } = await supabase
      .from("auctions")
      .update({ status: "ended", timer_status: "stopped" })
      .eq("id", auction.id)
      .select("*")
      .single();

    setEnding(false);
    setShowEndConfirm(false);

    if (endError) {
      setError(endError.message);
      return;
    }

    setAuction(updated);
    setCurrent(null);
  };

  const resumeAuction = async () => {
    if (!auction || resuming) return;
    setResuming("resume");
    setError(null);

    const { data: updated, error: resumeError } = await supabase
      .from("auctions")
      .update({ status: "live" })
      .eq("id", auction.id)
      .select("*")
      .single();

    if (resumeError) {
      setError(resumeError.message);
      setResuming(null);
      return;
    }

    setAuction(updated);
    const { data: refreshedTeams } = await supabase.from("teams").select("*").order("name", { ascending: true });
    setTeams(refreshedTeams ?? []);
    // Pick up exactly where the auction left off — same current_auction_player_id,
    // current_bid, and highest_bidder_team_id as before it was ended.
    await Promise.all([
      loadCurrent(updated),
      loadSquadStats(updated.id),
      loadCounts(updated.id),
      loadQueue(updated.id),
    ]);
    setResuming(null);
  };

  const startNewAuction = async () => {
    if (!auction || resuming) return;
    const confirmed = window.confirm(
      "This permanently clears every sold/unsold result, refunds every team's purse, and restarts from the first player. This can't be undone. Start a new auction?"
    );
    if (!confirmed) return;

    setResuming("new");
    setError(null);

    // Put every queued player back to pending.
    await supabase
      .from("auction_players")
      .update({ status: "pending", final_price: null, sold_to_team_id: null, re_auction_count: 0 })
      .eq("auction_id", auction.id);

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

    // Reset the auction pointer itself so the next load picks the very first player.
    const { data: updated, error: resetError } = await supabase
      .from("auctions")
      .update({
        status: "live",
        current_auction_player_id: null,
        current_bid: 0,
        highest_bidder_team_id: null,
        timer_remaining: auction.timer_seconds,
        timer_status: "stopped",
      })
      .eq("id", auction.id)
      .select("*")
      .single();

    if (resetError) {
      setError(resetError.message);
      setResuming(null);
      return;
    }

    setAuction(updated);
    const { data: refreshedTeams } = await supabase.from("teams").select("*").order("name", { ascending: true });
    setTeams(refreshedTeams ?? []);
    await Promise.all([
      loadCurrent(updated),
      loadSquadStats(updated.id),
      loadCounts(updated.id),
      loadQueue(updated.id),
    ]);
    setResuming(null);
  };

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center gap-2 bg-abyss text-parchment/60"
        style={PAGE_BACKGROUND_STYLE}
      >
        <Loader2 className="h-5 w-5 animate-spin" /> Loading live auction…
      </div>
    );
  }

  if (!auction) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-abyss px-4 text-center text-parchment"
        style={PAGE_BACKGROUND_STYLE}
      >
        <p className="text-sm text-parchment/60">{error ?? "No auction configured yet."}</p>
        <Button asChild>
          <a href="/auction">Go to Auction Setup →</a>
        </Button>
      </div>
    );
  }

  const showTeamsPanel = teams.length > 0;
  const squadTeam = squadTeamId ? teams.find((t) => t.id === squadTeamId) ?? null : null;

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-abyss px-4 py-4 sm:px-8 sm:py-5"
      style={PAGE_BACKGROUND_STYLE}
    >
      <header className="mx-auto mb-4 flex w-full max-w-4xl shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="rounded-md p-2 text-parchment/60 hover:bg-cove hover:text-parchment" aria-label="Back to dashboard">
            <ArrowLeft className="h-5 w-5" />
          </a>
          <Anchor className="h-5 w-5 text-brass" strokeWidth={1.75} />
          <div>
            <p className="font-display text-base leading-tight text-parchment sm:text-lg">{auction.name}</p>
            <p className="text-xs uppercase tracking-wide text-lagoon/70">Live Auction</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-parchment/60">
          <Badge variant="neutral">{counts.pending} pending</Badge>
          <Badge variant="matched">{counts.sold} sold</Badge>
          <Badge variant="missing">{counts.unsold} unsold</Badge>
          {showTeamsPanel && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTeams((v) => !v)}
                aria-label="Show team purses"
                aria-expanded={showTeams}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 transition-colors",
                  showTeams
                    ? "border-lagoon-bright/50 bg-lagoon/15 text-lagoon-bright"
                    : "border-wood-light/30 bg-cove/70 text-parchment/70 hover:bg-cove hover:text-parchment"
                )}
              >
                <Menu className="h-4 w-4" />
                <span className="hidden sm:inline">Team purses</span>
              </button>

              {showTeams && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowTeams(false)} />
                  <div className="absolute right-0 z-40 mt-2 w-80 max-w-[85vw] rounded-lg border border-wood-light/25 bg-deep p-3 text-left shadow-deck">
                    <p className="mb-2 px-1 text-xs uppercase tracking-wide text-parchment/50">Team purses · tap to bid</p>
                    <div className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto pr-1">
                      {teams.map((team) => {
                        const stat = squadStats[team.id] ?? { count: 0, overseasCount: 0 };
                        const nextBid =
                          current && auction
                            ? auction.current_bid > 0
                              ? auction.current_bid + getBidIncrement(auction.current_bid)
                              : current.player.base_price
                            : 0;
                        const isHighest = auction?.highest_bidder_team_id === team.id;
                        const disabled =
                          !current ||
                          busy ||
                          isHighest ||
                          nextBid > team.purse_remaining ||
                          stat.count >= team.squad_size_limit ||
                          (isOverseas(current?.player.country) && stat.overseasCount >= team.overseas_limit);
                        const spentPct =
                          team.purse_total > 0 ? ((team.purse_total - team.purse_remaining) / team.purse_total) * 100 : 0;

                        return (
                          <button
                            key={team.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => placeBid(team)}
                            className={cn(
                              "flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
                              isHighest
                                ? "border-lagoon-bright bg-lagoon/15"
                                : "border-wood-light/20 bg-deep/40 hover:bg-cove disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-deep/40"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-display text-sm text-parchment">
                                {team.code} <span className="ml-1 text-xs font-normal text-parchment/40">{team.name}</span>
                              </span>
                              {isHighest && <Badge variant="matched">Leading</Badge>}
                            </div>
                            <div className="flex items-center justify-between text-xs text-parchment/60">
                              <span>{formatCr(team.purse_remaining)} left</span>
                              <span>
                                {stat.count}/{team.squad_size_limit} squad · {stat.overseasCount}/{team.overseas_limit} O/S
                              </span>
                            </div>
                            <Progress value={spentPct} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {auction.status !== "ended" && (
            <button
              type="button"
              onClick={() => setShowEndConfirm(true)}
              className="flex items-center gap-1.5 rounded-md border border-coral/40 bg-coral/10 px-2.5 py-1.5 text-coral transition-colors hover:bg-coral/20"
            >
              <Square className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">End auction</span>
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="mx-auto mb-3 w-full max-w-4xl shrink-0 rounded-md border border-coral/40 bg-coral/10 px-4 py-3 text-sm text-coral">
          {error}
        </div>
      )}

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center overflow-y-auto">
        {auction.status === "ended" ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <Square className="h-8 w-8 text-coral" />
              <div>
                <p className="font-display text-xl text-parchment">Auction ended</p>
                <p className="mt-1 text-sm text-parchment/60">
                  {counts.sold} sold · {counts.unsold} unsold · {counts.pending} still pending.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button size="lg" onClick={resumeAuction} disabled={resuming !== null}>
                  {resuming === "resume" ? <Loader2 className="h-5 w-5 animate-spin" /> : <PlayCircle className="h-5 w-5" />}
                  Resume auction
                </Button>
                <Button size="lg" variant="destructive" onClick={startNewAuction} disabled={resuming !== null}>
                  {resuming === "new" ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
                  Start new auction
                </Button>
              </div>
              <p className="max-w-sm text-xs text-parchment/40">
                Resume picks up exactly where you left off. Start new clears every result, refunds every purse, and
                restarts from the first player.
              </p>
            </CardContent>
          </Card>
        ) : noQueue ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <p className="text-sm text-parchment/60">No players queued yet.</p>
              <Button asChild>
                <a href="/auction">Build the queue in Auction Setup →</a>
              </Button>
            </CardContent>
          </Card>
        ) : complete || !current ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
              <CheckCircle2 className="h-8 w-8 text-lagoon-bright" />
              <p className="font-display text-xl text-parchment">Auction complete</p>
              <p className="text-sm text-parchment/60">
                {counts.sold} sold · {counts.unsold} unsold of {counts.total} queued players.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-6 text-center sm:py-8">
                <div className="h-36 w-36 shrink-0 overflow-hidden rounded-2xl border-2 border-wood-light/30 bg-cove shadow-deck sm:h-48 sm:w-48 lg:h-56 lg:w-56">
                  {current.player.image_url ? (
                    <img src={current.player.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-parchment/20">
                      <Anchor className="h-12 w-12" strokeWidth={1} />
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Badge variant="neutral">{current.player.set_code ?? "—"}</Badge>
                    {current.player.is_marquee && <Badge variant="needs_review">Marquee</Badge>}
                  </div>
                  <h1 className="mt-2 font-display text-3xl leading-tight text-parchment sm:text-4xl lg:text-5xl">
                    {current.player.name}
                  </h1>
                  <p className="mt-1 text-sm text-parchment/60 sm:text-base">
                    {current.player.country ?? "—"} · {current.player.role ?? "—"} · Base {formatCr(current.player.base_price)}
                  </p>
                </div>
                <div className="rounded-lg bg-deep/60 px-6 py-3 text-center sm:px-8 sm:py-4">
                  <p className="text-xs uppercase tracking-wide text-parchment/50">Current bid</p>
                  <p className="font-display text-3xl text-lagoon-bright sm:text-4xl">
                    {auction.current_bid > 0 ? formatCr(auction.current_bid) : "—"}
                  </p>
                  {auction.highest_bidder_team_id && (
                    <p className="mt-1 text-sm text-parchment/60">
                      {teams.find((t) => t.id === auction.highest_bidder_team_id)?.name}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Sold / Unsold */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                className="flex-1"
                disabled={!auction.highest_bidder_team_id || busy}
                onClick={finalizeSold}
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Gavel className="h-5 w-5" />} SOLD
              </Button>
              <Button size="lg" variant="destructive" className="flex-1" disabled={busy} onClick={finalizeUnsold}>
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <XCircle className="h-5 w-5" />} UNSOLD
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Left floating toggle for the player-status drawer */}
      <button
        type="button"
        onClick={() => setShowQueue(true)}
        aria-label="Show player status"
        className="fixed left-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-wood-light/30 bg-cove/90 px-2 py-3 text-parchment/70 shadow-deck backdrop-blur transition-colors hover:bg-cove hover:text-parchment"
      >
        <ListChecks className="h-5 w-5" />
        <span className="text-[9px] font-medium uppercase tracking-wide">Players</span>
      </button>

      {/* Top-left floating toggle for the team squads / purse drawer */}
      {showTeamsPanel && (
        <button
          type="button"
          onClick={() => setShowSquads(true)}
          aria-label="Show team squads"
          className="fixed left-3 top-3 z-30 flex items-center gap-1.5 rounded-xl border border-wood-light/30 bg-cove/90 px-3 py-2.5 text-parchment/70 shadow-deck backdrop-blur transition-colors hover:bg-cove hover:text-parchment"
        >
          <Users className="h-4 w-4" />
          <span className="text-[11px] font-medium uppercase tracking-wide">Squads</span>
        </button>
      )}

      {/* Top-right floating toggle to undo the most recent bid — mirrors the Squads
          button on the top-left, and sits clear of the current-bid card and the team
          rail beneath it. Only shown once there's actually a bid to undo. */}
      {!complete && current && !!auction.highest_bidder_team_id && (
        <button
          type="button"
          title="Undo last bid — restores the previous bid and bidder"
          onClick={undoBid}
          disabled={busy}
          className="fixed right-3 top-20 z-30 flex items-center gap-1.5 rounded-xl border border-wood-light/30 bg-cove/90 px-3 py-2.5 text-parchment/70 shadow-deck backdrop-blur transition-colors hover:bg-cove hover:text-parchment disabled:cursor-not-allowed disabled:opacity-40 sm:top-3"
        >
          <Undo2 className="h-4 w-4" />
          <span className="text-[11px] font-medium uppercase tracking-wide">Undo bid</span>
        </button>
      )}

      {/* Right floating column of one circular bid button per team */}
      {showTeamsPanel && !complete && current && (
        <div className="fixed right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2">
          {teams.map((team) => {
            const stat = squadStats[team.id] ?? { count: 0, overseasCount: 0 };
            const nextBid =
              current && auction
                ? auction.current_bid > 0
                  ? auction.current_bid + getBidIncrement(auction.current_bid)
                  : current.player.base_price
                : 0;
            const isHighest = auction?.highest_bidder_team_id === team.id;
            const disabled =
              !current ||
              busy ||
              isHighest ||
              nextBid > team.purse_remaining ||
              stat.count >= team.squad_size_limit ||
              (isOverseas(current?.player.country) && stat.overseasCount >= team.overseas_limit);

            return (
              <button
                key={team.id}
                type="button"
                title={`Bid for ${team.name} · next bid ${formatCr(nextBid)} · ${formatCr(team.purse_remaining)} left`}
                aria-label={`Bid for ${team.name}`}
                disabled={disabled}
                onClick={() => placeBid(team)}
                style={{ borderColor: team.primary_color ?? undefined }}
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 bg-cove/90 text-[11px] font-display font-semibold uppercase tracking-wide text-parchment shadow-deck backdrop-blur transition-all",
                  "hover:scale-110 hover:bg-cove disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:scale-100 disabled:hover:bg-cove/90",
                  isHighest && "scale-110 bg-lagoon/25 ring-2 ring-lagoon-bright"
                )}
              >
                {team.code}
              </button>
            );
          })}
        </div>
      )}

      {/* Player-status slide-over drawer */}
      {showQueue && (
        <div className="fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-abyss/70 backdrop-blur-sm" onClick={() => setShowQueue(false)} />
          <div className="relative z-10 flex h-full w-full max-w-xs flex-col gap-3 border-r border-wood-light/20 bg-deep p-4 shadow-deck">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-parchment/50">Player status</p>
              <button
                type="button"
                onClick={() => setShowQueue(false)}
                aria-label="Close"
                className="rounded-md p-1 text-parchment/60 hover:bg-cove hover:text-parchment"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-parchment/50">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-lagoon-bright" /> Sold
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-coral" /> Unsold
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full border border-wood-light/40" /> Pending
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-brass" /> Live
              </span>
            </div>

            {/* Set filter chips — jump the list to just one marquee/capped/uncapped set */}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setQueueFilter("all")}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  queueFilter === "all"
                    ? "border-lagoon-bright/60 bg-lagoon/20 text-lagoon-bright"
                    : "border-wood-light/25 bg-deep/40 text-parchment/60 hover:bg-cove"
                )}
              >
                All
              </button>
              {AUCTION_SET_SEQUENCE.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  title={s.label}
                  onClick={() => setQueueFilter(s.code)}
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    queueFilter === s.code
                      ? "border-lagoon-bright/60 bg-lagoon/20 text-lagoon-bright"
                      : "border-wood-light/25 bg-deep/40 text-parchment/60 hover:bg-cove"
                  )}
                >
                  {s.code}
                </button>
              ))}
            </div>

            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {queue
                .filter((qp) => queueFilter === "all" || qp.player?.set_code === queueFilter)
                .map((qp) => {
                  const isCurrent = current?.id === qp.id;
                  const soldTeam = qp.status === "sold" ? teams.find((t) => t.id === qp.sold_to_team_id) : undefined;
                  return (
                    <div
                      key={qp.id}
                      title={
                        soldTeam
                          ? `Sold to ${soldTeam.name} for ${formatCr(qp.final_price ?? 0)}`
                          : undefined
                      }
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                        isCurrent
                          ? "border-brass bg-brass/15 ring-1 ring-brass"
                          : qp.status === "sold"
                          ? "border-lagoon/40 bg-lagoon/10"
                          : qp.status === "unsold"
                          ? "border-coral/40 bg-coral/10"
                          : "border-wood-light/15 bg-deep/30"
                      )}
                    >
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          isCurrent
                            ? "bg-brass"
                            : qp.status === "sold"
                            ? "bg-lagoon-bright"
                            : qp.status === "unsold"
                            ? "bg-coral"
                            : "border border-wood-light/40"
                        )}
                      />
                      <span className="w-8 shrink-0 text-[10px] uppercase text-parchment/40">
                        {qp.player?.set_code ?? "—"}
                      </span>
                      <span className="flex-1 truncate text-sm text-parchment/80">{qp.player?.name ?? "—"}</span>
                      {soldTeam ? (
                        <span className="shrink-0 rounded border border-lagoon/40 bg-lagoon/15 px-1.5 py-0.5 text-[10px] font-semibold text-lagoon-bright">
                          {soldTeam.code}
                        </span>
                      ) : qp.status === "unsold" ? (
                        <span className="shrink-0 text-[10px] text-coral">Unsold</span>
                      ) : null}
                    </div>
                  );
                })}
              {queue.filter((qp) => queueFilter === "all" || qp.player?.set_code === queueFilter).length === 0 && (
                <p className="py-6 text-center text-xs text-parchment/40">No players in this set.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Team squads slide-over drawer — pick a team, see who they've bought and for how much */}
      {showSquads && (
        <div className="fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-abyss/70 backdrop-blur-sm" onClick={closeSquadsPanel} />
          <div className="relative z-10 flex h-full w-full max-w-xs flex-col gap-3 border-r border-wood-light/20 bg-deep p-4 shadow-deck">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {squadTeam && (
                  <button
                    type="button"
                    onClick={() => {
                      setSquadTeamId(null);
                      setSquadRoster([]);
                    }}
                    aria-label="Back to teams"
                    className="rounded-md p-1 text-parchment/60 hover:bg-cove hover:text-parchment"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <p className="text-xs uppercase tracking-wide text-parchment/50">
                  {squadTeam ? `${squadTeam.name} squad` : "Team squads"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeSquadsPanel}
                aria-label="Close"
                className="rounded-md p-1 text-parchment/60 hover:bg-cove hover:text-parchment"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!squadTeam ? (
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {teams.map((team) => {
                  const stat = squadStats[team.id] ?? { count: 0, overseasCount: 0 };
                  const spentPct =
                    team.purse_total > 0 ? ((team.purse_total - team.purse_remaining) / team.purse_total) * 100 : 0;
                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => openTeamSquad(team.id)}
                      className="flex flex-col gap-2 rounded-lg border border-wood-light/20 bg-deep/40 px-3 py-2.5 text-left transition-colors hover:bg-cove"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-sm text-parchment">
                          {team.code} <span className="ml-1 text-xs font-normal text-parchment/40">{team.name}</span>
                        </span>
                        <span className="text-xs text-parchment/50">
                          {stat.count}/{team.squad_size_limit} bought
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-parchment/60">
                        <span>{formatCr(team.purse_remaining)} left</span>
                        <span>of {formatCr(team.purse_total)}</span>
                      </div>
                      <Progress value={spentPct} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
                <div className="rounded-lg border border-wood-light/20 bg-deep/40 px-3 py-2.5">
                  <div className="flex items-center justify-between text-sm text-parchment">
                    <span className="font-display">
                      {squadTeam.name} <span className="text-parchment/40">({squadTeam.code})</span>
                    </span>
                    <span className="font-display text-lagoon-bright">{formatCr(squadTeam.purse_remaining)} left</span>
                  </div>
                  <p className="mt-1 text-xs text-parchment/50">
                    Spent {formatCr(squadTeam.purse_total - squadTeam.purse_remaining)} of{" "}
                    {formatCr(squadTeam.purse_total)} · {squadRoster.length} player
                    {squadRoster.length === 1 ? "" : "s"} bought
                  </p>
                </div>

                {squadRosterLoading ? (
                  <div className="flex flex-1 items-center justify-center text-parchment/50">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : squadRoster.length === 0 ? (
                  <p className="py-6 text-center text-xs text-parchment/40">No players bought yet.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {squadRoster.map((p) => (
                      <div
                        key={p.player_id}
                        className="flex items-center gap-2 rounded-md border border-wood-light/15 bg-deep/30 px-2.5 py-2"
                      >
                        <span className="flex-1 truncate text-sm text-parchment/80">
                          {p.name}
                          {p.role ? <span className="ml-1.5 text-[10px] uppercase text-parchment/40">{p.role}</span> : null}
                        </span>
                        {p.is_overseas && (
                          <span className="shrink-0 rounded border border-wood-light/30 px-1 py-0.5 text-[10px] text-parchment/50">
                            O/S
                          </span>
                        )}
                        <span className="shrink-0 text-sm font-medium text-lagoon-bright">{formatCr(p.price)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Big "sold" reveal popup */}
      <Dialog
        open={!!soldInfo}
        onOpenChange={(open) => {
          if (!open) runAdvance();
        }}
      >
        <DialogContent className="max-w-md border-2 border-lagoon-bright/40 bg-deep text-center">
          {soldInfo && (
            <div className="flex flex-col items-center gap-4 py-4 animate-sold-reveal">
              <Badge variant="matched" className="gap-1 px-3 py-1 text-sm">
                <PartyPopper className="h-3.5 w-3.5" /> SOLD
              </Badge>
              <div className="h-28 w-28 overflow-hidden rounded-full border-2 border-lagoon-bright/50 bg-cove">
                {soldInfo.playerImage ? (
                  <img src={soldInfo.playerImage} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <h2 className="font-display text-3xl leading-tight text-parchment">{soldInfo.playerName}</h2>
              <p className="text-sm text-parchment/60">goes to</p>
              <p className="font-display text-4xl leading-tight text-brass-bright">
                {soldInfo.teamName} <span className="text-2xl text-parchment/50">({soldInfo.teamCode})</span>
              </p>
              <p className="font-display text-2xl text-lagoon-bright">{formatCr(soldInfo.price)}</p>
              <div className="mt-2 flex w-full flex-col items-center gap-2">
                <p className="text-xs text-parchment/40">Next player in {autoAdvanceSeconds}s…</p>
                <Button size="lg" className="w-full" onClick={runAdvance}>
                  Next Player <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Set-complete transition popup — fires the moment the next player drawn belongs
          to a new set further along the fixed running order. */}
      <Dialog open={!!setTransition} onOpenChange={(open) => !open && setSetTransition(null)}>
        <DialogContent className="max-w-sm border-2 border-brass/40 bg-deep text-center">
          {setTransition && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Badge variant="needs_review" className="px-3 py-1 text-sm">
                Set complete
              </Badge>
              <h2 className="font-display text-2xl leading-tight text-parchment">
                {setTransition.fromLabel} has ended
              </h2>
              <p className="text-sm text-parchment/60">Now entering</p>
              <p className="font-display text-3xl leading-tight text-brass-bright">{setTransition.toLabel}</p>
              <Button size="lg" className="mt-2 w-full" onClick={() => setSetTransition(null)}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* End auction confirmation */}
      <Dialog open={showEndConfirm} onOpenChange={(open) => !ending && setShowEndConfirm(open)}>
        <DialogContent className="max-w-sm border-2 border-coral/40 bg-deep text-center">
          <div className="flex flex-col items-center gap-4 py-2">
            <Square className="h-8 w-8 text-coral" />
            <div>
              <h2 className="font-display text-xl text-parchment">End this auction?</h2>
              <p className="mt-1 text-sm text-parchment/60">
                Bidding will stop right where it is. You can resume later, or start a fresh auction from here next
                time you open this page.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="flex-1" onClick={() => setShowEndConfirm(false)} disabled={ending}>
                Cancel
              </Button>
              <Button variant="destructive" className="flex-1" onClick={endAuction} disabled={ending}>
                {ending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} End auction
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
